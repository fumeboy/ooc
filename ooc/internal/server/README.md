# HTTP 服务层 (internal/server)

## 使命
- 提供 REST/SSE 接口：Session CRUD、Conversation 操作、事件推送。
- 把 `agent` 与 `session` 能力封装成安全的外部 API。

## 路由草案
- `POST /sessions`：创建 Story。
- `GET /sessions/{id}`：查询状态。
- `POST /sessions/{id}/ask`：用户回答 Ask。
- `GET /sessions/{id}/events`：SSE 推送。

## 架构
- `Router`：基于 chi/gin（后续决定）。
- `Middleware`：日志/认证/限流。
- `Controller`：只做参数校验 + 调用 `agent`。

## TDD
- 使用 httptest 驱动 handler。
- Mock session store + agent，以验证 HTTP 层不会泄漏内部结构。

## TODO
- [ ] 选择具体 HTTP 框架。
- [ ] 设计错误码。
