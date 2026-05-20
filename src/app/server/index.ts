import { Elysia } from "elysia";
import { setPauseChecker } from "@src/observable";
import { readServerConfig, type ServerConfig } from "./bootstrap/config";
import { AppServerError } from "./bootstrap/errors";
import { healthModule } from "./modules/health";
import { runtimeModule } from "./modules/runtime";
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
  buildServer(config).listen(config.port);
  console.log(`[ooc-app-server] listening on :${config.port}`);
  console.log(`[ooc-app-server] world dir: ${config.baseDir}`);
  console.log(`[ooc-app-server] debug chat: http://127.0.0.1:${config.port}/debug/chat.html`);
}
