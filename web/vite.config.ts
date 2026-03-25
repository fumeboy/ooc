import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/** user repo 根目录（kernel/web/ → 上两级 → user/） */
const USER_ROOT = path.resolve(__dirname, "../..");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __OOC_ROOT__: JSON.stringify(USER_ROOT),
  },
  resolve: {
    alias: {
      "@ooc": path.resolve(__dirname, "src"),
      "@stones": path.resolve(USER_ROOT, "stones"),
      "@flows": path.resolve(USER_ROOT, "flows"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
    fs: {
      allow: [
        ".",
        path.resolve(USER_ROOT, "stones"),
        path.resolve(USER_ROOT, "flows"),
      ],
    },
  },
});
