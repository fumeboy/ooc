import { createJobManager } from "../runtime/job-manager";
import { createPauseStore } from "../runtime/pause-store";

export interface ServerConfig {
  port: number;
  baseDir: string;
  workerPollMs: number;
  workerEnabled: boolean;
  /** 单个 run-thread job 内 scheduler 最多 think 的轮次。超出即提前退出（thread 状态保留）。 */
  workerMaxTicks: number;
  pauseStore: ReturnType<typeof createPauseStore>;
  jobManager: ReturnType<typeof createJobManager>;
}

export function readServerConfig(): ServerConfig {
  return {
    port: Number(process.env.OOC_APP_PORT ?? 3000),
    baseDir: process.env.OOC_BASE_DIR ?? process.cwd(),
    workerPollMs: Number(process.env.OOC_WORKER_POLL_MS ?? 100),
    workerEnabled: process.env.OOC_WORKER_ENABLED !== "0",
    workerMaxTicks: Number(process.env.OOC_WORKER_MAX_TICKS ?? 15),
    pauseStore: createPauseStore(),
    jobManager: createJobManager(),
  };
}
