import { Elysia } from "elysia";
import { setPauseChecker, setThreadActivationNotifier } from "@ooc/core/observable";
import { readServerConfig, type ServerConfig } from "./bootstrap/config";
import { runRecoveryCheck } from "./bootstrap/recovery-check";
import { checkStoneToPoolMigration, reportPoolMigration } from "./bootstrap/check-pool-migration";
import { checkStaleDatabaseDir } from "./bootstrap/check-stale-database-dir";
import { checkFlowChildrenMigration } from "./bootstrap/check-flow-children-migration";
import { checkStateContextSplit } from "./bootstrap/check-state-context-split";
import { ensureSupervisorObject } from "./bootstrap/ensure-supervisor";
import { ensureUserObject } from "./bootstrap/ensure-user";
import { ensureStoneRepo } from "@ooc/core/persistable";
import { AppServerError } from "./bootstrap/errors";
import { healthModule } from "./modules/health";
import { runtimeModule } from "./modules/runtime";
import { poolsModule } from "./modules/pools";
import { stonesModule } from "./modules/stones";
import { flowsModule } from "./modules/flows";
import { uiModule } from "./modules/ui";
import { worldConfigModule } from "./modules/world-config";
import { enqueueRunningThreadsAtBootstrap, startJobWorker } from "./runtime/worker";
import { maybeForwardToLark, startLarkEventRelay } from "@ooc/core/extendable/lark";

/** AppServerError 类别码 → HTTP 状态码映射。 */
const ERROR_HTTP_STATUS: Record<AppServerError["code"], number> = {
  NOT_FOUND: 404,
  METHOD_NOT_FOUND: 404,
  INVALID_INPUT: 400,
  VALIDATION: 422,
  CONFLICT: 409,
  THREAD_NOT_RUNNABLE: 409,
  THREAD_NOT_PAUSED: 409,
  JOB_ALREADY_RUNNING: 409,
  PAUSE_STILL_ENABLED: 409,
  OVERWRITE_REQUIRES_CONFIRM: 409,
  METHOD_LOAD_FAILED: 500,
  INTERNAL_ERROR: 500,
};

/**
 * 从 typebox schema 提取字面允许值列表（R7-3 修）。
 *
 * typebox 把 `t.Union([t.Literal("stone"), t.Literal("flow")])` 渲染成
 * `{ anyOf: [{ const: "stone", type: "string" }, { const: "flow", type: "string" }] }`。
 * 默认 ValidationError.summary 只输出 type 名（"'string', 'string'"）——开发者看不到
 * 真正允许的值。本函数提取所有 const 字面值，拼成 friendly hint。
 */
function extractAllowedConsts(schema: unknown): string[] | undefined {
  const s = schema as { anyOf?: Array<{ const?: unknown }>; const?: unknown };
  if (s?.const !== undefined) {
    return [JSON.stringify(s.const)];
  }
  if (Array.isArray(s?.anyOf)) {
    const consts = s.anyOf
      .map((branch) => branch?.const)
      .filter((c): c is string | number | boolean => c !== undefined && c !== null);
    if (consts.length > 0) {
      return consts.map((c) => JSON.stringify(c));
    }
  }
  return undefined;
}

/**
 * Elysia ValidationError.all 项压缩：每条只保留 {path, expected (schema 类型), message}。
 * 避免 R2 #8 的 >2KB 噪音（原始项嵌套整个 schema JSON）。
 *
 * R7-3（2026-05-25）：若 schema 是 union of literals，message 改为
 * "should be one of: <const list>"，让 typebox union 错误真正可读。
 */
function compressValidationItem(item: unknown): { path?: string; expected?: string; message?: string } {
  const it = item as {
    path?: string;
    schema?: { type?: string; anyOf?: unknown; const?: unknown };
    message?: string;
    summary?: string;
  };
  const allowedConsts = extractAllowedConsts(it?.schema);
  const friendlyMessage = allowedConsts
    ? `should be one of: ${allowedConsts.join(", ")}`
    : (it?.summary ?? it?.message);
  return {
    path: it?.path,
    expected: it?.schema?.type,
    message: friendlyMessage,
  };
}

/**
 * 根因 #8（2026-05-24）：错误模型统一。所有错误来源经此归一为
 * `{error:{code,message,details}}` 包络。
 *
 * - `elysiaCode === "NOT_FOUND"`（Elysia 默认未匹配路由）→ NOT_FOUND 404 +
 *   details.{path,method}（修 R5 #38 /health 500、R6 #49 code+message 自相矛盾）
 * - `elysiaCode === "VALIDATION"` 或 error.code === "VALIDATION" → 422，details
 *   压缩为 [{path,expected,message}]，message 用 summary（修 R2 #8 >2KB 嘈杂）
 * - `AppServerError` → 走 ERROR_HTTP_STATUS 映射
 * - 裸 fs ENOENT/EISDIR → NOT_FOUND 404
 * - 其它 unknown → INTERNAL_ERROR 500
 */
function normalizeErrorToJson(
  error: unknown,
  // Elysia onError 的 `code` 字段可能是 string（内置错误类别）或 number（status 码兜底）。
  elysiaCode?: string | number,
  reqInfo?: { path?: string; method?: string },
): { status: number; body: { error: { code: string; message: string; details: unknown } } } {
  // AppServerError 优先（注意：抛出的 AppServerError 若 .code === "NOT_FOUND"，
  // Elysia 也会把 onError 的 `elysiaCode` 设为 "NOT_FOUND"——所以必须先按错误对象
  // 类型分流，再走 Elysia code dispatch，否则 service 层 throw 的 NOT_FOUND 会被
  // 误判为 Elysia route 未匹配）。
  if (error instanceof AppServerError) {
    return {
      status: ERROR_HTTP_STATUS[error.code] ?? 500,
      body: { error: { code: error.code, message: error.message, details: error.details ?? null } },
    };
  }
  // Elysia 默认未匹配路由：onError 收到 code="NOT_FOUND" 且 error 是 NotFoundError。
  // 修 R5 #38 /health 500、R6 #49 code+message 自相矛盾（之前落到 INTERNAL_ERROR 500
  // + message="NOT_FOUND" 兜底分支）。
  if (elysiaCode === "NOT_FOUND") {
    return {
      status: 404,
      body: {
        error: {
          code: "NOT_FOUND",
          message: reqInfo?.path
            ? `route not found: ${reqInfo.method ?? "GET"} ${reqInfo.path}`
            : "route not found",
          details: reqInfo ?? null,
        },
      },
    };
  }
  // Elysia 验证错误：error.code === "VALIDATION" 且 .all 为数组；压缩 details。
  const anyErr = error as { code?: string; message?: string; all?: unknown; summary?: string };
  if (elysiaCode === "VALIDATION" || (anyErr && anyErr.code === "VALIDATION")) {
    const all = Array.isArray(anyErr?.all) ? anyErr.all.map(compressValidationItem) : null;
    // friendly message：优先用第一项的 summary，避免 ValidationError.message 含整个 schema dump
    const firstMsg = all && all[0]?.message;
    return {
      status: 422,
      body: {
        error: {
          code: "VALIDATION",
          message: anyErr.summary ?? firstMsg ?? "request validation failed",
          details: all,
        },
      },
    };
  }
  // 裸 Node fs ENOENT / EISDIR 等 — 映射成 NOT_FOUND。
  const fsCode = (error as NodeJS.ErrnoException | undefined)?.code;
  if (fsCode === "ENOENT" || fsCode === "EISDIR") {
    return {
      status: 404,
      body: {
        error: {
          code: "NOT_FOUND",
          message: (error as Error).message || `${fsCode}: resource not found`,
          details: { fsCode },
        },
      },
    };
  }
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: (error as Error)?.message ?? String(error),
        details: null,
      },
    },
  };
}

export function buildServer(config: ServerConfig) {
  setPauseChecker((thread) => {
    const sessionId = thread.persistence?.sessionId;
    return config.pauseStore.isGlobalPauseEnabled() || (sessionId ? config.pauseStore.isSessionPaused(sessionId) : false);
  });
  // 根因 #5（2026-05-24）：worker 事件驱动改造。事件源（talk-delivery /
  // do_window.continue / end auto-reply）写完对端 inbox 后
  // 调 notifyThreadActivated → 这里把它转成 jobManager.createRunThreadJob。
  // 不再依赖 worker 周期扫 fs 兜底入队。
  //
  // 2026-05-25：新增 lark event-relay 反向钩子 — 当 lark-chat-* session 的 user.root
  // 被激活（说明 supervisor 给 user 发了消息），透传到飞书 chat。
  setThreadActivationNotifier((ref) => {
    // user 是被动 flow object（控制面驱动）—— 不入 worker 队列，避免被 LLM tick。
    // 但 lark event-relay 仍然要收到 user 激活信号，把 supervisor 的回复透传到飞书。
    // 历史上这个 skip 在 talk-delivery 里直接短路 notify，现在下移到这里：
    // talk-delivery 总 notify，callback 决定要不要 forward 到 jobManager。
    if (ref.objectId !== "user") {
      config.jobManager.createRunThreadJob(ref);
    }
    maybeForwardToLark(ref);
  });

  const app = new Elysia({ name: "ooc.app.server" })
    // 根因 #8（2026-05-24）：统一所有错误为 { error: { code, message, details } } shape。
    // Elysia 的 `code` 参数区分内置错误类型（NOT_FOUND / VALIDATION / PARSE /
    // INTERNAL_SERVER_ERROR / UNKNOWN），透传给 normalizeErrorToJson 以避免
    // Elysia 默认 not-found 被兜底成 INTERNAL_ERROR(R6 #49 / R5 #38 根因)。
    .onError(({ error, code, set, request, path }) => {
      const reqInfo = { path: path ?? (request ? new URL(request.url).pathname : undefined), method: request?.method };
      const { status, body } = normalizeErrorToJson(error, code, reqInfo);
      set.status = status;
      return body;
    })
    .use(healthModule)
    .use(runtimeModule(config))
    .use(stonesModule(config))
    .use(poolsModule(config))
    .use(uiModule(config))
    .use(flowsModule(config))
    .use(worldConfigModule(config));

  if (config.workerEnabled) {
    // 根因 #5：启动期把磁盘上 running/waiting 的 thread 入队一次（bootstrap-only，
    // 替代旧的"周期扫 fs 兜底"路径）。然后 worker 只跑队列，不再周期扫。
    // fire-and-forget：不阻塞 buildServer 同步返回。
    void enqueueRunningThreadsAtBootstrap(config).catch((err) => {
      console.warn(
        `[ooc-app-server] bootstrap enqueue failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    const worker = startJobWorker(config);
    // 2026-05-25 lark event-relay：若 .world.json 配了 LarkAppId/Secret，启动 ws 长连接
    // 接收 im.message.receive_v1，反向触发 OOC session（fire-and-forget；缺凭证时 noop）。
    let stopLarkRelay: () => Promise<void> = async () => {};
    void startLarkEventRelay(config)
      .then((stop) => {
        stopLarkRelay = stop;
      })
      .catch((err) => {
        console.warn(
          `[ooc-app-server] startLarkEventRelay failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    app.onStop(() => {
      worker.stop();
      void stopLarkRelay();
    });
  }

  return app;
}

if (import.meta.main) {
  const config = await readServerConfig();

  // 2026-05-20: stones/ git repo bootstrap — init bare repo + main worktree,
  // migrate old flat layout if needed. Must come before any metaprog write.
  try {
    const repo = await ensureStoneRepo({ baseDir: config.baseDir });
    if (repo.initialized) {
      console.log(
        `[ooc-app-server] stones git repo initialized at ${config.baseDir}/stones/ ` +
          `(bare layout, bootstrap commit ${repo.bootstrapCommit?.slice(0, 8)})`,
      );
    }
  } catch (e) {
    console.error(`[ooc-app-server] ensureStoneRepo FATAL: ${e instanceof Error ? e.message : e}`);
    throw e;
  }

  // 2026-05-25: supervisor stone 是 World bootstrap invariant。
  // 第一启动自动建（含 self.md / readme.md / 5 篇 seed knowledge），后续 idempotent skip。
  // 是 R5 #32 (recovery-check 假设 supervisor 存在但空 world 没有) 的彻底解。
  try {
    const supervisor = await ensureSupervisorObject({ baseDir: config.baseDir });
    if (supervisor.created) {
      console.log(
        `[ooc-app-server] supervisor package created — ` +
          `OOC World bootstrap invariant: user 默认通过 supervisor 与系统交互`,
      );
    }
  } catch (e) {
    // bootstrap invariant 失败不允许 server 跑下去——区别于后续的 advisory 类 check
    console.error(`[ooc-app-server] ensureSupervisorObject FATAL: ${e instanceof Error ? e.message : e}`);
    throw e;
  }

  // 2026-05-25: user stone 也是 World bootstrap invariant。
  // 它是真人用户的占位 Object，readme.md 定义 inline UI token 协议；其它 Object 通过
  // relation_window 读到 user.readme，学到怎么用 [[ui...ui]] 指给用户看东西。
  try {
    const userStone = await ensureUserObject({ baseDir: config.baseDir });
    if (userStone.created) {
      console.log(
        `[ooc-app-server] user package created — ` +
          `OOC World bootstrap invariant: Object → user 消息渲染入口 + inline UI 协议`,
      );
    }
  } catch (e) {
    console.error(`[ooc-app-server] ensureUserObject FATAL: ${e instanceof Error ? e.message : e}`);
    throw e;
  }

  // U8: Recovery 自检——遍历 stones/main/{Object}/server/index.ts，加载失败的开 PR-Issue。
  // 不阻塞启动；Supervisor 在自己的 super flow 看到 recovery-needed Issue 后决策回滚。
  try {
    const recovery = await runRecoveryCheck({ baseDir: config.baseDir });
    if (recovery.broken.length > 0) {
      console.log(
        `[ooc-app-server] recovery-check: ${recovery.broken.length} broken stone(s) — ` +
          `${recovery.newIssues.length} new PR-Issue(s) opened in super session`,
      );
      // R5 #37:dump 每个 broken stone 的 objectId + reason,让运维不用翻 super
      // session 也能看到 root cause
      for (const b of recovery.broken) {
        console.log(`[ooc-app-server] recovery-check broken: objectId=${b.objectId} reason=${b.reason}`);
      }
    }
  } catch (e) {
    console.warn(`[ooc-app-server] recovery-check failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }

  // 2026-05-23 三分重组：检测 stone 仍持有 knowledge/ 或 files/、但对应 pool 还没建的 object，
  // 提示用户跑一次性迁移命令。不自动迁移；不阻塞启动。
  try {
    const migration = await checkStoneToPoolMigration({ baseDir: config.baseDir });
    reportPoolMigration(migration, config.baseDir);
  } catch (e) {
    console.warn(`[ooc-app-server] pool-migration check failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }

  // 2026-05-24 二次简化：检测 stone 仍持有 database/ 残留子目录（2026-05-23 六件套时代遗留；
  // sql_pool 删除后该目录已无语义）。advisory，不阻塞启动。
  await checkStaleDatabaseDir(config.baseDir);

  // 2026-05-27: flow 子 object 物理布局迁移到 children/ marker（与 stone 对称）。
  // 幂等：已是 children/ 形态的不动。必须在 worker bootstrap 入队前跑（worker.scanRunningThreads
  // 期望 children/ 布局）。
  await checkFlowChildrenMigration(config.baseDir);

  // 2026-06-02 (ooc-6 P6.§6): split state (object dim) vs context (thread dim).
  // 把遗留的 talk/do/method_exec 独立目录与 state.json 中错置的 contextWindows 字段
  // 一次性归位。幂等。
  await checkStateContextSplit(config.baseDir);

  // hostname: "0.0.0.0" 显式 IPv4 监听（兼 IPv6 dual-stack on macOS）。
  // 之前默认 listen 在 macOS bun 上只绑 IPv6（lsof: `*:3000` 但 IPv6 only），
  // vite proxy target 用 `127.0.0.1`（IPv4）连不上 → /api/* 全 502。
  buildServer(config).listen({ port: config.port, hostname: "0.0.0.0" });
  console.log(`[ooc-app-server] listening on 0.0.0.0:${config.port}`);
  console.log(`[ooc-app-server] world dir: ${config.baseDir}`);
}
