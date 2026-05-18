import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const apiTarget = process.env.OOC_API_TARGET ?? "http://127.0.0.1:3000";

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
      "Set it to the same world directory as the backend (e.g. OOC_WORLD_DIR=./.ooc-world-test bun run dev).",
  );
}
const worldRoot = resolve(worldDir);

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
