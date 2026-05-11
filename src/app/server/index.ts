import { Elysia } from "elysia";
import { setPauseChecker } from "@src/observable";
import { readServerConfig, type ServerConfig } from "./bootstrap/config";
import { healthModule } from "./modules/health";
import { runtimeModule } from "./modules/runtime";
import { stonesModule } from "./modules/stones";
import { flowsModule } from "./modules/flows";
import { startJobWorker } from "./runtime/worker";

export function buildServer(config: ServerConfig = readServerConfig()) {
  setPauseChecker((thread) => {
    const sessionId = thread.persistence?.sessionId;
    return config.pauseStore.isGlobalPauseEnabled() || (sessionId ? config.pauseStore.isSessionPaused(sessionId) : false);
  });

  const app = new Elysia({ name: "ooc.app.server" })
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
