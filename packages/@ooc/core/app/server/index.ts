/**
 * OOC app server 入口 —— bootstrap + Elysia listen。
 *
 * 用法：
 *   bun run packages/@ooc/core/app/server/index.ts --world ./.ooc-world --port 3000
 *
 * **issue F1 (2026-06-29)**: buildServer 经 createWorldRuntime 启动 — 获取 stoneRegistry /
 * serverLoader / reloadTable / hot-reload watcher (dev 模式),把 reloadTable 透给
 * runtime module,兑现 lifecycle.on_reload 在生产 server 派发。
 */
import { Elysia } from "elysia";
import "@ooc/core/runtime/object-register.builtins.js";
import { createWorldRuntime, type WorldRuntime } from "@ooc/core/runtime/world-runtime.js";
import { parseServerConfig } from "./bootstrap/config.js";
import { healthModule } from "./modules/health/index.js";
import { buildRuntimeModule, type RuntimeModuleConfig } from "./modules/runtime/index.js";

export interface BuildServerConfig extends RuntimeModuleConfig {
  /** dev 模式开关 — 默认 true (开 hot-reload watcher + lifecycle.on_reload 派发)。 */
  dev?: boolean;
}

/**
 * 构建一个完整的 OOC app server 实例。
 *
 * 启动时自动 `createWorldRuntime({ worldPath: config.baseDir, dev: config.dev ?? true })`,
 * 把 WorldRuntime 挂在 Elysia decorator 上 (`ctx.worldRuntime`),并透给 runtime module。
 *
 * 返回的 app 持 `worldRuntime` 字段,关停时调用方需调 `app.stop()` + `worldRuntime.dispose()`
 * 释放 hot-reload watcher 与缓存。
 */
export function buildServer(config: BuildServerConfig) {
  const worldRuntime = createWorldRuntime({
    worldPath: config.baseDir,
    dev: config.dev ?? true,
  });
  const app = new Elysia()
    .decorate("baseDir", config.baseDir)
    .decorate("worldRuntime", worldRuntime)
    .use(healthModule)
    .use(buildRuntimeModule({ ...config, worldRuntime }));
  // 把 worldRuntime 暴露在 app 对象上, 调用方 (test / runner) 可显式 dispose。
  // (Elysia decorator 只对 handler ctx 可见, 不暴露给 app 持有者。)
  return Object.assign(app, { worldRuntime });
}

if (import.meta.main) {
  const cfg = parseServerConfig(process.argv.slice(2));
  const app = buildServer(cfg);
  app.listen(cfg.port);
  console.log(`[server] OOC app listening on :${cfg.port} (world=${cfg.baseDir}, dev=${cfg.dev ?? true})`);
}
