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
import { buildStonesModule } from "./modules/stones/index.js";
import { buildFlowsModule } from "./modules/flows/index.js";
import { buildSessionsModule } from "./modules/sessions/index.js";
import { buildWorldConfigModule } from "./modules/world-config/index.js";

export interface BuildServerConfig extends RuntimeModuleConfig {
  /** dev 模式开关 — 默认 true (开 hot-reload watcher + lifecycle.on_reload 派发)。 */
  dev?: boolean;
}

/**
 * 构建一个完整的 OOC app server 实例。
 *
 * Modules:
 *   - health        : /health 健康检查
 *   - runtime       : /api/runtime/* (F1 + S8 global-pause/debug)
 *   - stones        : /api/stones, /api/stones/:id/file (S1+S3 list/create + file-edit)
 *   - flows         : /api/flows, /api/flows/:sid/{...} (S2+S4+S5+S6)
 *   - sessions      : /api/sessions (S5)
 *   - world-config  : /api/world/config (S8)
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
    .use(buildRuntimeModule({ ...config, worldRuntime }))
    .use(buildStonesModule({ baseDir: config.baseDir }))
    .use(buildFlowsModule({ ...config, worldRuntime }))
    .use(buildSessionsModule({ ...config, worldRuntime }))
    .use(buildWorldConfigModule({ baseDir: config.baseDir }));
  return Object.assign(app, { worldRuntime });
}

if (import.meta.main) {
  const cfg = parseServerConfig(process.argv.slice(2));
  const app = buildServer(cfg);
  app.listen(cfg.port);
  console.log(`[server] OOC app listening on :${cfg.port} (world=${cfg.baseDir}, dev=${cfg.dev ?? true})`);
}
