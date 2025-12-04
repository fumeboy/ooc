# Web 前端规划

## 目标
- 可视化 Session/Conversation/Action 过程。
- 在收到 Ask 时提示用户输入，转发到后端。

## 功能列表
- Session 列表 + 状态过滤。
- 对话详情：展示 LLM 思考步骤、模块调用。
- Ask/Respond 交互。
- Story Runner 结果回放。

## 技术栈候选
- React + Vite（首选）或 SvelteKit。
- SSE/WebSocket 用于事件流。

## TDD
- 使用组件测试 (Testing Library) + Playwright 端到端。

## TODO
- [ ] 设计 UI 草图。
- [ ] 定义与后端的 DTO。
