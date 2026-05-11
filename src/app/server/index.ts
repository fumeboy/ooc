import { Elysia } from "elysia";
import { setPauseChecker } from "@src/observable";
import { readServerConfig, type ServerConfig } from "./bootstrap/config";
import { AppServerError } from "./bootstrap/errors";
import { healthModule } from "./modules/health";
import { runtimeModule } from "./modules/runtime";
import { stonesModule } from "./modules/stones";
import { flowsModule } from "./modules/flows";
import { startJobWorker } from "./runtime/worker";

/** AppServerError 类别码 → HTTP 状态码映射。 */
const ERROR_HTTP_STATUS: Record<AppServerError["code"], number> = {
  NOT_FOUND: 404,
  METHOD_NOT_FOUND: 404,
  INVALID_INPUT: 400,
  CONFLICT: 409,
  THREAD_NOT_RUNNABLE: 409,
  THREAD_NOT_PAUSED: 409,
  JOB_ALREADY_RUNNING: 409,
  PAUSE_STILL_ENABLED: 409,
  METHOD_LOAD_FAILED: 500,
  INTERNAL_ERROR: 500,
};

export function buildServer(config: ServerConfig = readServerConfig()) {
  setPauseChecker((thread) => {
    const sessionId = thread.persistence?.sessionId;
    return config.pauseStore.isGlobalPauseEnabled() || (sessionId ? config.pauseStore.isSessionPaused(sessionId) : false);
  });

  const app = new Elysia({ name: "ooc.app.server" })
    // 把 AppServerError 映射成统一的 JSON + HTTP 状态码，避免一律 500。
    .onError(({ error, set }) => {
      if (error instanceof AppServerError) {
        set.status = ERROR_HTTP_STATUS[error.code] ?? 500;
        return {
          error: {
            code: error.code,
            message: error.message,
            details: error.details ?? null,
          },
        };
      }
      // 非 AppServerError 交给 Elysia 默认行为
      return;
    })
    .use(healthModule)
    .use(runtimeModule(config))
    .use(stonesModule(config))
    .use(flowsModule(config));

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
}
