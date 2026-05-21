import { createJobManager } from "../runtime/job-manager";
import { createPauseStore } from "../runtime/pause-store";
import { STONES_MAIN_BRANCH } from "@src/persistable";

export interface ServerConfig {
  port: number;
  baseDir: string;
  /**
   * 当前 server 实例绑定的 stones git 分支。默认 "main"；元编程沙箱场景由 Object
   * shell 启动子 server 实例时传 `--stones-branch={metaprog-...}` 切换（详见 U4）。
   */
  stonesBranch: string;
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

/** 校验 stonesBranch 形态：git ref 名 + 防止路径穿越。空值或非法字符抛错。 */
function validateStonesBranch(value: string): string {
  if (value.length === 0 || value.length > 128) {
    throw new Error(`invalid --stones-branch '${value}': length must be 1..128`);
  }
  // 简化集合：字母/数字/下划线/横杠/斜杠/点（git ref 兼容形态，例如 "metaprog/agent_of_x/abc123"）
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) {
    throw new Error(
      `invalid --stones-branch '${value}': only [A-Za-z0-9._/-] allowed`,
    );
  }
  // 防 ".." 段，避免 stones/{branch}/ 解析成 stones/.../<上一级>
  if (value.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
    throw new Error(`invalid --stones-branch '${value}': contains empty/relative path segment`);
  }
  return value;
}

export function readServerConfig(source: ConfigSource = {}): ServerConfig {
  const env = source.env ?? process.env;
  const argv = source.argv ?? process.argv;
  const explicitBaseDir = readFlagValue(argv, ["--world", "--world-dir", "--base-dir"]);
  const explicitBranch = readFlagValue(argv, ["--stones-branch"]);

  return {
    port: Number(env.OOC_APP_PORT ?? 3000),
    baseDir: explicitBaseDir ?? env.OOC_WORLD_DIR ?? env.OOC_BASE_DIR ?? process.cwd(),
    stonesBranch: validateStonesBranch(
      explicitBranch ?? env.OOC_STONES_BRANCH ?? STONES_MAIN_BRANCH,
    ),
    workerPollMs: Number(env.OOC_WORKER_POLL_MS ?? 100),
    workerEnabled: env.OOC_WORKER_ENABLED !== "0",
    workerMaxTicks: Number(env.OOC_WORKER_MAX_TICKS ?? 15),
    pauseStore: createPauseStore(),
    jobManager: createJobManager(),
  };
}
