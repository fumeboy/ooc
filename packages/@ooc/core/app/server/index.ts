/**
 * OOC app server 入口 —— bootstrap + Elysia listen。
 *
 * 用法：
 *   bun run packages/@ooc/core/app/server/index.ts --world ./.ooc-world --port 3000
 */
import { Elysia } from "elysia";
import "@ooc/core/runtime/object-register.builtins.js";
import { parseServerConfig } from "./bootstrap/config.js";
import { healthModule } from "./modules/health/index.js";
import { runtimeModule } from "./modules/runtime/index.js";

export function buildServer(config: { baseDir: string }) {
  return new Elysia()
    .decorate("baseDir", config.baseDir)
    .use(healthModule)
    .use(runtimeModule);
}

if (import.meta.main) {
  const cfg = parseServerConfig(process.argv.slice(2));
  const app = buildServer(cfg);
  app.listen(cfg.port);
  console.log(`[server] OOC app listening on :${cfg.port} (world=${cfg.baseDir})`);
}
