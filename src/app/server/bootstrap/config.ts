import { createJobManager } from "../runtime/job-manager";
import { createPauseStore } from "../runtime/pause-store";

export interface ServerConfig {
  port: number;
  baseDir: string;
  workerPollMs: number;
  workerEnabled: boolean;
  pauseStore: ReturnType<typeof createPauseStore>;
  jobManager: ReturnType<typeof createJobManager>;
}

export function readServerConfig(): ServerConfig {
  return {
    port: Number(process.env.OOC_APP_PORT ?? 3000),
    baseDir: process.env.OOC_BASE_DIR ?? process.cwd(),
    workerPollMs: Number(process.env.OOC_WORKER_POLL_MS ?? 100),
    workerEnabled: process.env.OOC_WORKER_ENABLED !== "0",
    pauseStore: createPauseStore(),
    jobManager: createJobManager(),
  };
}
