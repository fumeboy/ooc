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

type ConfigSource = {
  env?: Record<string, string | undefined>;
  argv?: string[];
};

function readFlagValue(argv: string[], names: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    for (const name of names) {
      if (arg === name) {
        return argv[index + 1];
      }
      const prefix = `${name}=`;
      if (arg.startsWith(prefix)) {
        return arg.slice(prefix.length);
      }
    }
  }
  return undefined;
}

export function readServerConfig(source: ConfigSource = {}): ServerConfig {
  const env = source.env ?? process.env;
  const argv = source.argv ?? process.argv;
  const explicitBaseDir = readFlagValue(argv, ["--world", "--world-dir", "--base-dir"]);

  return {
    port: Number(env.OOC_APP_PORT ?? 3000),
    baseDir: explicitBaseDir ?? env.OOC_WORLD_DIR ?? env.OOC_BASE_DIR ?? process.cwd(),
    workerPollMs: Number(env.OOC_WORKER_POLL_MS ?? 100),
    workerEnabled: env.OOC_WORKER_ENABLED !== "0",
    workerMaxTicks: Number(env.OOC_WORKER_MAX_TICKS ?? 15),
    pauseStore: createPauseStore(),
    jobManager: createJobManager(),
  };
}
