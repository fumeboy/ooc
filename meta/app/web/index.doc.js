export const app_web_v20260513_1 = {
  index: `
web 是 OOC app 层的浏览与人工操作入口。

职责边界：

- web 不拥有核心业务状态；核心状态仍落在 world 的 flows / stones 文件结构中。
- web 通过 app server API 读取目录树、文件内容、stones、flows，并复用 flows/runtime API 创建与继续 root thread chat。
- 本轮 web 只覆盖最小控制面闭环：flows / stones / world 浏览、session 创建、初始消息、继续 chat、文本文件查看。
- web 主动不迁移旧 Web 的 Kanban、Issue、Task、SSE 实时事件、Command Palette、复杂 FlowData 聚合模型和旧 /api/talk/:target 兼容层。

实现入口：

- 前端：web/src/app、web/src/domains、web/src/transport、web/src/shared。
- 服务端支撑：src/app/server/modules/ui 以及 src/app/server/modules/flows 的 GET /api/flows 列表能力。

启动方式：

1. 启动后端 app server，指向要浏览和操作的 world 目录：

   ```bash
   bun src/app/server/index.ts --world .ooc-world-test
   ```

   后端默认监听 3000 端口，并通过 /api 暴露 stones、flows、runtime 与 tree/file 读取接口。

2. 启动前端 Web dev server：

   ```bash
   cd web
   bun install
   bun run dev
   ```

   Vite dev server 会把 /api 请求代理到 http://127.0.0.1:3000，因此本地开发时需要先启动后端。

3. 构建前端静态产物：

   ```bash
   cd web
   bun run build
   ```
`,
};
