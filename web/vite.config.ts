import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __OOC_ROOT__: JSON.stringify(path.resolve(__dirname, "..")),
  },
  resolve: {
    alias: {
      "@ooc": path.resolve(__dirname, "src"),
      "@stones": path.resolve(__dirname, "../stones"),
      "@flows": path.resolve(__dirname, "../flows"),
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
        "../stones",
        "../flows",
      ],
    },
  },
});
