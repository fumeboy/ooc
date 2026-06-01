import { resolve } from "node:path";
import { createJobManager } from "../runtime/job-manager";
import { createPauseStore } from "../runtime/pause-store";
import { readWorldConfig } from "@ooc/core/persistable";

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

export async function readServerConfig(source: ConfigSource = {}): Promise<ServerConfig> {
  const env = source.env ?? process.env;
  const argv = source.argv ?? process.argv;
  const explicitBaseDir = readFlagValue(argv, ["--world", "--world-dir", "--base-dir"]);
  // baseDir 归一为绝对路径（root-cause #1）：下游 packageDir()/objectDir()/client-source-url
  // 的 `/@fs${absPath}` 要求绝对路径；相对 `--world ./.ooc-world` 启动若不归一会产出
  // 坏的 `/@fs.ooc-world/...` 让浏览器 import client page 失败。process.cwd() 默认值
  // 已是绝对，path.resolve 对其幂等。
  const rawBaseDir = explicitBaseDir ?? env.OOC_WORLD_DIR ?? env.OOC_BASE_DIR ?? process.cwd();
  const absBaseDir = resolve(rawBaseDir);
  const explicitPort = readFlagValue(argv, ["--port"]);

  const port = explicitPort !== undefined ? Number(explicitPort) : Number(env.OOC_APP_PORT ?? 3000);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(
      `invalid port '${explicitPort ?? env.OOC_APP_PORT}': must be an integer in (0, 65535]`,
    );
  }

  // workerMaxTicks 优先级：env > .world.json > 15
  // env 比 world-config 优先 — env 是 dev 临时覆盖，world-config 是项目级配置基线。
  // 显式传给 ServerConfig 字段的更高优先级路径走调用方解构覆盖（e2e fixture 模式）。
  const envMaxTicks = env.OOC_WORKER_MAX_TICKS;
  let workerMaxTicks: number;
  if (envMaxTicks !== undefined && envMaxTicks !== "") {
    workerMaxTicks = Number(envMaxTicks);
  } else {
    const worldCfg = await readWorldConfig(absBaseDir).catch(() => undefined);
    workerMaxTicks = worldCfg?.workerMaxTicks ?? 15;
  }

  return {
    port,
    baseDir: absBaseDir,
    workerPollMs: Number(env.OOC_WORKER_POLL_MS ?? 100),
    workerEnabled: env.OOC_WORKER_ENABLED !== "0",
    workerMaxTicks,
    pauseStore: createPauseStore(),
    jobManager: createJobManager(),
  };
}
