import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolve } from "node:path";

const apiTarget = process.env.OOC_API_TARGET ?? "http://127.0.0.1:3000";

/**
 * R6 #41:启动期 advisory health-check —— 若 OOC_API_TARGET 指错 / backend 未起,
 * proxy `/api/*` 全 500 但无任何提示;与 OOC_WORLD_DIR 的 fail-loud 形成不对称。
 *
 * 做法：vite 启动期对 `${apiTarget}/api/health` 发一次 GET;失败仅 console.warn,
 * 不阻断 dev server(allow developer 先起 vite 后起 backend 的常见流程)。
 */
function probeApiTarget(target: string): void {
  // fire-and-forget;3 秒 timeout 避免 vite startup 卡住
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  fetch(`${target}/api/health`, { signal: ctl.signal })
    .then((res) => {
      clearTimeout(timer);
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `[vite] OOC_API_TARGET=${target} responded ${res.status} on /api/health — backend may be misconfigured`,
        );
      }
    })
    .catch((err) => {
      clearTimeout(timer);
      // eslint-disable-next-line no-console
      console.warn(
        `[vite] OOC_API_TARGET=${target} unreachable (${err instanceof Error ? err.message : String(err)}); ` +
          `/api/* proxy will 5xx until backend is up. Start backend or override OOC_API_TARGET to match its --port.`,
      );
    });
}
probeApiTarget(apiTarget);

/**
 * OOC_WORLD_DIR：与 backend 同名 env（src/app/server/bootstrap/config.ts:43）。
 * 用作 ObjectClientRenderer 拼 `/@fs/${WORLD_ROOT}/stones|flows/...` 的根。
 *
 * 缺时 fail-loud —— plan §6 D4：避免静默指错目录变成头号 debug 黑洞。
 */
const worldDir = process.env.OOC_WORLD_DIR;
if (!worldDir) {
  throw new Error(
    "OOC_WORLD_DIR is not set; required for dynamic Object client loading. " +
      "Set it to the same world directory as the backend (e.g. OOC_WORLD_DIR=./.ooc-world bun run dev).",
  );
}
const worldRoot = resolve(worldDir);

export default defineConfig({
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  define: {
    __OOC_WORLD_ROOT__: JSON.stringify(worldRoot),
  },
  server: {
    proxy: {
      "/api": apiTarget,
    },
    fs: {
      // 允许 /@fs/ 访问 world 目录（默认 Vite 只允许项目根内的路径）
      allow: [resolve(import.meta.dirname, ".."), worldRoot],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        objectClient: resolve(import.meta.dirname, "object-client.html"),
      },
    },
  },
});
