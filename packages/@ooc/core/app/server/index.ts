import { Elysia } from "elysia";
import { setPauseChecker, setThreadActivationNotifier } from "@ooc/core/observable";
import { createWorldRuntime, type WorldRuntime } from "@ooc/core/runtime/world-runtime";
import { readServerConfig, type ServerConfig } from "./bootstrap/config";
import { runRecoveryCheck } from "./bootstrap/recovery-check";
import { checkFlowChildrenMigration } from "./bootstrap/check-flow-children-migration";
import { checkStateContextSplit } from "./bootstrap/check-state-context-split";
import { instantiateBuiltinClassObjects } from "./bootstrap/instantiate-classes";
import { ensureStoneRepo, createPoolObject, BUILTIN_OBJECT_IDS } from "@ooc/core/persistable";
import { AppServerError } from "./bootstrap/errors";
import { healthModule } from "./modules/health";
import { runtimeModule } from "./modules/runtime";
import { poolsModule } from "./modules/pools";
import { stonesModule } from "./modules/stones";
import { flowsModule } from "./modules/flows";
import { uiModule } from "./modules/ui";
import { worldConfigModule } from "./modules/world-config";
import { enqueueRunningThreadsAtBootstrap, startJobWorker } from "./runtime/worker";
import { maybeForwardToLark, startLarkEventRelay } from "@ooc/builtins/feishu_app";

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
 * 避免 >2KB 噪音（原始项嵌套整个 schema JSON）。
 *
 * 若 schema 是 union of literals，message 改为
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
 * 错误模型统一。所有错误来源经此归一为
 * `{error:{code,message,details}}` 包络。
 *
 * - `elysiaCode === "NOT_FOUND"`（Elysia 默认未匹配路由）→ NOT_FOUND 404 +
 *   details.{path,method}（修 /health 500、code+message 自相矛盾）
 * - `elysiaCode === "VALIDATION"` 或 error.code === "VALIDATION" → 422，details
 *   压缩为 [{path,expected,message}]，message 用 summary（修 >2KB 嘈杂）
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
  // 修 /health 500、code+message 自相矛盾（之前落到 INTERNAL_ERROR 500
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
  // 每个 buildServer 创建一个独立的 WorldRuntime 实例，
  // 封装 object registry / observable state / serial queue / server loader / stoneRegistry。
  // 目前挂到 Elysia state 上，后续阶段把对默认 module-level 实例的引用逐步迁移到 runtime。
  const runtime: WorldRuntime = createWorldRuntime({
    worldPath: config.baseDir,
    dev: config.dev,
  });

  setPauseChecker((thread) => {
    const sessionId = thread.persistence?.sessionId;
    return config.pauseStore.isGlobalPauseEnabled() || (sessionId ? config.pauseStore.isSessionPaused(sessionId) : false);
  });
  // worker 事件驱动改造。事件源（talk-delivery /
  // do_window.continue / end auto-reply）写完对端 inbox 后
  // 调 notifyThreadActivated → 这里把它转成 jobManager.createRunThreadJob。
  // 不再依赖 worker 周期扫 fs 兜底入队。
  //
  // lark event-relay 反向钩子 — 当 lark-chat-* session 的 user.root
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
    // 统一所有错误为 { error: { code, message, details } } shape。
    // Elysia 的 `code` 参数区分内置错误类型（NOT_FOUND / VALIDATION / PARSE /
    // INTERNAL_SERVER_ERROR / UNKNOWN），透传给 normalizeErrorToJson 以避免
    // Elysia 默认 not-found 被兜底成 INTERNAL_ERROR。
    .state("runtime", runtime)
    .onError(({ error, code, set, request, path }) => {
      const reqInfo = { path: path ?? (request ? new URL(request.url).pathname : undefined), method: request?.method };
      const { status, body } = normalizeErrorToJson(error, code, reqInfo);
      set.status = status;
      return body;
    })
    .use(healthModule)
    .use(runtimeModule(config))
    .use(stonesModule(config, runtime))
    .use(poolsModule(config))
    .use(uiModule(config))
    .use(flowsModule(config))
    .use(worldConfigModule(config));

  if (config.workerEnabled) {
    // 启动期把磁盘上 running/waiting 的 thread 入队一次（bootstrap-only，
    // 替代旧的"周期扫 fs 兜底"路径）。然后 worker 只跑队列，不再周期扫。
    // fire-and-forget：不阻塞 buildServer 同步返回。
    void enqueueRunningThreadsAtBootstrap(config).catch((err) => {
      console.warn(
        `[ooc-app-server] bootstrap enqueue failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    const worker = startJobWorker(config);
    // lark event-relay：若 .world.json 配了 LarkAppId/Secret，启动 ws 长连接
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
    app.onStop(async () => {
      worker.stop();
      await stopLarkRelay();
      await runtime.dispose();
    });
  } else {
    app.onStop(() => runtime.dispose());
  }

  return app;
}

if (import.meta.main) {
  const config = await readServerConfig();

  // stones/ git repo bootstrap — init bare repo + main worktree,
  // migrate old flat layout if needed. Must come before any stone write.
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

  // Builtin Object（supervisor / user）的 pool 骨架 idempotent 预创。
  // Builtin 的 stone/definition 随 OOC 代码仓发布（packages/@ooc/builtins/），不写 world；
  // 但 pool 是 world 内的跨 session 沉淀层，仍然需要 pools/<id>/ 目录存在。
  for (const objectId of BUILTIN_OBJECT_IDS) {
    try {
      await createPoolObject({ baseDir: config.baseDir, objectId });
    } catch (e) {
      console.error(
        `[ooc-app-server] createPoolObject(${objectId}) FATAL: ${e instanceof Error ? e.message : e}`,
      );
      throw e;
    }
  }

  // 把带 ooc.instantiate_with_new_world 的框架 builtin class（supervisor）
  // 幂等实例化为 objects/<id> 可交互 object（拷贝 self.md + ooc.class=_builtin/<id>）。
  // 让全新 world 自动拥有 supervisor object——不再靠 listStones 特殊逻辑合入。
  try {
    const inst = await instantiateBuiltinClassObjects({ baseDir: config.baseDir });
    if (inst.instantiated.length > 0) {
      console.log(`[ooc-app-server] instantiated builtin class object(s): ${inst.instantiated.join(", ")}`);
    }
  } catch (e) {
    console.error(
      `[ooc-app-server] instantiateBuiltinClassObjects FATAL: ${e instanceof Error ? e.message : e}`,
    );
    throw e;
  }

  // U8: Recovery 自检——遍历 stones/main/{Object}/executable/index.ts，加载失败的开 PR-Issue。
  // 不阻塞启动；Supervisor 在自己的 super flow 看到 recovery-needed Issue 后决策回滚。
  try {
    const recovery = await runRecoveryCheck({ baseDir: config.baseDir });
    if (recovery.broken.length > 0) {
      console.log(
        `[ooc-app-server] recovery-check: ${recovery.broken.length} broken stone(s) — ` +
          `${recovery.newIssues.length} new PR-Issue(s) opened in super session`,
      );
      // dump 每个 broken stone 的 objectId + reason,让运维不用翻 super
      // session 也能看到 root cause
      for (const b of recovery.broken) {
        console.log(`[ooc-app-server] recovery-check broken: objectId=${b.objectId} reason=${b.reason}`);
      }
    }
  } catch (e) {
    console.warn(`[ooc-app-server] recovery-check failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }

  // 移除两项一次性迁移 advisory（checkStoneToPoolMigration / checkStaleDatabaseDir）——
  // 它们扫描 deprecated `<world>/packages/<id>/` 布局，该布局已随 packages/ 兼容层一并删除，永远空返回。

  // flow 子 object 物理布局迁移到 children/ marker（与 stone 对称）。
  // 幂等：已是 children/ 形态的不动。必须在 worker bootstrap 入队前跑（worker.scanRunningThreads
  // 期望 children/ 布局）。
  await checkFlowChildrenMigration(config.baseDir);

  // split state (object dim) vs context (thread dim).
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
