/**
 * server config —— 启动参数 + world 寻址。
 *
 * 设计：必须显式 `--world <path>`，否则回退 cwd → 污染源码树（CLAUDE.md「关键约束 1」）。
 *
 * **issue F1 (2026-06-29)**: 加 `--no-dev` flag — 默认 dev=true 开 hot-reload watcher;
 * --no-dev 显式关 (生产环境精简、不监听 fs.watch)。
 */
import { resolve } from "node:path";

export interface ServerConfig {
  baseDir: string;
  port: number;
  workerMaxTicks?: number;
  /** dev 模式 — 默认 true (开 hot-reload watcher + lifecycle.on_reload 派发); --no-dev 关。 */
  dev: boolean;
}

export function parseServerConfig(argv: string[]): ServerConfig {
  let world: string | undefined;
  let port = 3000;
  let dev = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--world" && argv[i + 1]) {
      world = argv[++i];
    } else if (a === "--port" && argv[i + 1]) {
      port = Number.parseInt(argv[++i]!, 10);
    } else if (a === "--no-dev") {
      dev = false;
    } else if (a === "--dev") {
      dev = true;
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
    dev,
  };
}
