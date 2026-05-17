import { app_server_v20260511_1 } from "@meta/app/server/index.doc";
import { app_web_v20260513_1 } from "@meta/app/web/index.doc";

export const app_v20260514_1 = {
  index: `
app 描述 OOC 内核之上的应用层入口。

当前 app 层先聚焦控制面服务：

- server：基于 Elysia 的 HTTP 控制面，面向 UI、工程工具和人工操作暴露 OOC 基础能力。
- web：基于 React/Vite 的最小 Web 控制面，调用 server API 浏览 world、管理 session 并继续 root thread chat。

## 启动 app server 的世界根目录约定

本仓库根 \`~/x/ooc/ooc-2\` 仅放代码与 meta；world 状态（flows/stones/...）
**不应**写在源码树里。约定使用 \`~/x/ooc/ooc-2/.ooc-world-test\` 作为
world 目录。

启动命令必须显式传 \`--world\`：

\`\`\`bash
cd.
bun --env-file=.env src/app/server/index.ts --world./.ooc-world-test
\`\`\`

不带 \`--world\` 时 \`config.ts\` 会回退到 \`process.cwd()\`，把源码目录当 world——
这是错误用法，禁止。

## 本地联调补充知识

控制面 API 的“404 but 不是全部 404”在本地开发时，未必是代码没写进去，也可能是**旧 server 进程还活着**。

一个典型症状是：

- \`GET /api/health\` 正常；
- 某些旧路由也正常；
- 但新加的路由（例如 \`GET /api/runtime/debug/status\`）返回 404。

这通常说明当前端口上有多个 bun server 竞争或残留，实际收到请求的是旧实例；旧实例的路由表没有最新变更，于是看起来像“新接口不存在”。

排查原则：

- 先看端口监听：\`lsof -nP -iTCP:3000 -sTCP:LISTEN\`
- 若发现多个监听进程，先清理旧进程，再启动新的 app server
- 不要只看 \`health\` 是否可用；要直接探测新增控制面路由本身

另外，app server 读取的端口环境变量是 \`OOC_APP_PORT\`，不是 \`OOC_PORT\`。若切端口后服务仍然起在 3000，应优先检查这里的环境变量名是否写对。

这条经验背后的原则是：**控制面调试要先确认“你打到的是不是你以为的那个进程”**。
`,
  server: app_server_v20260511_1,
  web: app_web_v20260513_1,
};

export const app_tree_v20260514_1 = {
  get parent() { return app_v20260514_1; },
  server: app_server_v20260511_1,
  web: app_web_v20260513_1,
};

export const app_v20260511_1 = app_v20260514_1;
export const app_tree_v20260511_1 = app_tree_v20260514_1;
