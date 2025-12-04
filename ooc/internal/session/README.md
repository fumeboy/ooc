# Session 模块

## 职责
- 记录一次用户请求的完整生命周期：Story 输入 → Conversation/Action 轨迹 → Result → Ask/Respond 事件。
- 提供查询、回放、持久化接口。

## 数据结构
- `Session`：id/userRequest/stories/result/status/timestamps。
- `Event`：ConversationStarted, ActionExecuted, AskRaised, Responded 等。
- `Store` 接口：`Save`, `Load`, `AppendEvent`, `ListByUser`。

## TDD
- `session_store_test.go`：内存实现，覆盖 save/load/append。
- `event_stream_test.go`：验证事件顺序与过滤。

## TODO
- [x] 内存 Store + 事件流测试。
- [ ] 定义持久化后端（sqlite?）。
- [ ] 设计与前端的 SSE/WebSocket 协议。
