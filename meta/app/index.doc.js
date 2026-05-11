import { app_server_v20260511_1 } from "@meta/app/server/index.doc";

export const app_v20260511_1 = {
  index: `
app 描述 OOC 内核之上的应用层入口。

当前 app 层先聚焦控制面服务：

- server：基于 Elysia 的 HTTP 控制面，面向 UI、工程工具和人工操作暴露 OOC 基础能力。
`,
  server: app_server_v20260511_1,
};

export const app_tree_v20260511_1 = {
  get parent() { return app_v20260511_1; },
  server: app_server_v20260511_1,
};
