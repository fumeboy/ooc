import { Elysia } from "elysia";
import { setPauseChecker } from "@src/observable";
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
import { startJobWorker } from "./runtime/worker";

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
 * 把任意未知 error 归一为统一 JSON shape。Issue #6 Bad #2 修复:
 * - AppServerError → 走 ERROR_HTTP_STATUS 映射
 * - fs ENOENT(没经 service 层 catch 的兜底) → NOT_FOUND 404
 * - Elysia schema 验证错误 (code === "VALIDATION") → 422
 * - 其它 unknown → INTERNAL_ERROR 500;原始 message 进 details.cause
 */
function normalizeErrorToJson(error: unknown): { status: number; body: { error: { code: string; message: string; details: unknown } } } {
  if (error instanceof AppServerError) {
    return {
      status: ERROR_HTTP_STATUS[error.code] ?? 500,
      body: { error: { code: error.code, message: error.message, details: error.details ?? null } },
    };
  }
  // Elysia 验证错误对象:含 .code === "VALIDATION" 和 .all / .summary 字段。
  const anyErr = error as { code?: string; message?: string; all?: unknown; summary?: string };
  if (anyErr && anyErr.code === "VALIDATION") {
    return {
      status: 422,
      body: {
        error: {
          code: "VALIDATION",
          message: anyErr.summary ?? anyErr.message ?? "request validation failed",
          details: anyErr.all ?? null,
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

  const app = new Elysia({ name: "ooc.app.server" })
    // Issue #6 Bad #2: 统一所有错误为 { error: { code, message, details } } shape;
    // AppServerError / Elysia 验证 / 裸 fs ENOENT 都走 normalizeErrorToJson。
    .onError(({ error, set }) => {
      const { status, body } = normalizeErrorToJson(error);
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
