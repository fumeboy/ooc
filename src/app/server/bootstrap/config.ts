import { resolve } from "node:path";
import { STONES_MAIN_BRANCH, readWorldConfig } from "@src/persistable";

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
  // _todo: P8+ implement pauseStore (global/session pause gate) and jobManager (job queue)
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

export async function readServerConfig(source: ConfigSource = {}): Promise<ServerConfig> {
  const env = source.env ?? process.env;
  const argv = source.argv ?? process.argv;
  const explicitBaseDir = readFlagValue(argv, ["--world", "--world-dir", "--base-dir"]);
  // baseDir 归一为绝对路径（root-cause #1）：下游 stoneDir()/objectDir()/client-source-url
  // 的 `/@fs${absPath}` 要求绝对路径；相对 `--world ./.ooc-world` 启动若不归一会产出
  // 坏的 `/@fs.ooc-world/...` 让浏览器 import client page 失败。process.cwd() 默认值
  // 已是绝对，path.resolve 对其幂等。
  const rawBaseDir = explicitBaseDir ?? env.OOC_WORLD_DIR ?? env.OOC_BASE_DIR ?? process.cwd();
  const absBaseDir = resolve(rawBaseDir);
  const explicitBranch = readFlagValue(argv, ["--stones-branch"]);
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
    // intentional: .world.json is optional config — missing is normal
    const worldCfg = await readWorldConfig(absBaseDir).catch(() => undefined);
    workerMaxTicks = worldCfg?.workerMaxTicks ?? 15;
  }

  return {
    port,
    baseDir: absBaseDir,
    stonesBranch: validateStonesBranch(
      explicitBranch ?? env.OOC_STONES_BRANCH ?? STONES_MAIN_BRANCH,
    ),
    workerPollMs: Number(env.OOC_WORKER_POLL_MS ?? 100),
    workerEnabled: env.OOC_WORKER_ENABLED !== "0",
    workerMaxTicks,
  };
}
