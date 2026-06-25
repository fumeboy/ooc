/**
 * server config —— 启动参数 + world 寻址。
 *
 * 设计：必须显式 `--world <path>`，否则回退 cwd → 污染源码树（CLAUDE.md「关键约束 1」）。
 */
import { resolve } from "node:path";

export interface ServerConfig {
  baseDir: string;
  port: number;
  workerMaxTicks?: number;
}

export function parseServerConfig(argv: string[]): ServerConfig {
  let world: string | undefined;
  let port = 3000;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--world" && argv[i + 1]) {
      world = argv[++i];
    } else if (a === "--port" && argv[i + 1]) {
      port = Number.parseInt(argv[++i]!, 10);
    }
  }
  if (!world) {
    throw new Error(
      "[server] missing --world <path>. App server must be started with explicit --world to avoid polluting source tree.",
    );
  }
  return {
    baseDir: resolve(world),
    port,
    workerMaxTicks: 15,
  };
}
