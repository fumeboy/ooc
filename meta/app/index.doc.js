import { app_server_v20260511_1 } from "@meta/app/server/index.doc";
import { app_web_v20260513_1 } from "@meta/app/web/index.doc";

export const app_v20260511_1 = {
  index: `
app 描述 OOC 内核之上的应用层入口。

当前 app 层先聚焦控制面服务：

- server：基于 Elysia 的 HTTP 控制面，面向 UI、工程工具和人工操作暴露 OOC 基础能力。
- web：基于 React/Vite 的最小 Web 控制面，调用 server API 浏览 world、管理 session 并继续 root thread chat。
`,
  server: app_server_v20260511_1,
  web: app_web_v20260513_1,
};

export const app_tree_v20260511_1 = {
  get parent() { return app_v20260511_1; },
  server: app_server_v20260511_1,
  web: app_web_v20260513_1,
};
