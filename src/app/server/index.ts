import { Elysia } from "elysia";
import { setPauseChecker, setThreadActivationNotifier } from "@src/observable";
import { ensureStoneRepo } from "@src/persistable";
import { readServerConfig, type ServerConfig } from "./bootstrap/config";
import { runRecoveryCheck } from "./bootstrap/recovery-check";
import { checkStoneToPoolMigration, reportPoolMigration } from "./bootstrap/check-pool-migration";
import { checkStaleDatabaseDir } from "./bootstrap/check-stale-database-dir";
import { AppServerError } from "./bootstrap/errors";
import { healthModule } from "./modules/health";
import { runtimeModule } from "./modules/runtime";
import { poolsModule } from "./modules/pools";
import { stonesModule } from "./modules/stones";
import { flowsModule } from "./modules/flows";
import { issuesModule } from "./modules/issues";
import { uiModule } from "./modules/ui";
import { debugUiModule } from "./modules/debug-ui";
import { enqueueRunningThreadsAtBootstrap, startJobWorker } from "./runtime/worker";

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
 * Elysia ValidationError.all 项压缩：每条只保留 {path, expected (schema 类型), message}。
 * 避免 R2 #8 的 >2KB 噪音（原始项嵌套整个 schema JSON）。
 */
function compressValidationItem(item: unknown): { path?: string; expected?: string; message?: string } {
  const it = item as { path?: string; schema?: { type?: string }; message?: string; summary?: string };
  return {
    path: it?.path,
    expected: it?.schema?.type,
    message: it?.summary ?? it?.message,
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

export function buildServer(config: ServerConfig = readServerConfig()) {
  setPauseChecker((thread) => {
    const sessionId = thread.persistence?.sessionId;
    return config.pauseStore.isGlobalPauseEnabled() || (sessionId ? config.pauseStore.isSessionPaused(sessionId) : false);
  });
  // 根因 #5（2026-05-24）：worker 事件驱动改造。事件源（talk-delivery /
  // do_window.continue / issue appendComment / end auto-reply）写完对端 inbox 后
  // 调 notifyThreadActivated → 这里把它转成 jobManager.createRunThreadJob。
  // 不再依赖 worker 周期扫 fs 兜底入队。
  setThreadActivationNotifier((ref) => {
    config.jobManager.createRunThreadJob(ref);
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
    .use(debugUiModule())
    .use(healthModule)
    .use(runtimeModule(config))
    .use(stonesModule(config))
    .use(poolsModule(config))
    .use(uiModule(config))
    .use(flowsModule(config))
    .use(issuesModule(config));

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
    app.onStop(() => {
      worker.stop();
    });
  }

  return app;
}

if (import.meta.main) {
  const config = readServerConfig();
  // U1: stones/ git auto-init + 旧扁平布局迁移到 stones/main/。bare repo + linked
  // worktrees 模式：bare 仓库在 stones/.stones_repo/，main worktree 在 stones/main/。
  // 失败抛错并退出（启动期一次性副作用，无法静默继续）。
  const repoStatus = await ensureStoneRepo({ baseDir: config.baseDir });
  if (repoStatus.initialized) {
    console.log(
      `[ooc-app-server] stones/.stones_repo (bare) initialized + main worktree attached ` +
        `(commit ${repoStatus.bootstrapCommit?.slice(0, 8)})`,
    );
  } else if (repoStatus.bootstrapCommit) {
    console.log(`[ooc-app-server] stones/ HEAD unborn — wrote bootstrap commit ${repoStatus.bootstrapCommit.slice(0, 8)}`);
  }
  if (repoStatus.layout === "legacy-embedded") {
    console.log(
      `[ooc-app-server] stones/ uses legacy embedded .git layout (.stones_repo + worktrees not active)`,
    );
  }
  if (repoStatus.migrated) {
    console.log(`[ooc-app-server] stones/ migrated flat layout into stones/main/`);
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
    }
  } catch (e) {
    console.warn(`[ooc-app-server] recovery-check failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }

  // 2026-05-23 三分重组：检测 stone 仍持有 knowledge/ 或 files/、但对应 pool 还没建的 object，
  // 提示用户跑一次性迁移命令。不自动迁移；不阻塞启动。
  try {
    const migration = await checkStoneToPoolMigration({ baseDir: config.baseDir, branch: config.stonesBranch });
    reportPoolMigration(migration, config.baseDir);
  } catch (e) {
    console.warn(`[ooc-app-server] pool-migration check failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }

  // 2026-05-24 二次简化：检测 stone 仍持有 database/ 残留子目录（2026-05-23 六件套时代遗留；
  // sql_pool 删除后该目录已无语义）。advisory，不阻塞启动。
  await checkStaleDatabaseDir(config.baseDir, config.stonesBranch);

  buildServer(config).listen(config.port);
  console.log(`[ooc-app-server] listening on :${config.port}`);
  console.log(`[ooc-app-server] world dir: ${config.baseDir}`);
  console.log(`[ooc-app-server] stones-branch: ${config.stonesBranch}`);
  console.log(`[ooc-app-server] debug chat: http://127.0.0.1:${config.port}/debug/chat.html`);
}
