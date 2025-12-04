# LLM 客户端 (internal/client/llm)

## 目标
- 对接 zhipu ai REST API，屏蔽请求拼装与限流。
- 提供 FakeClient 供 TDD 使用。

## 模块拆分
- `client.go`：真实 HTTP 实现，支持 streaming。
- `fake.go`：脚本化响应，Story Runner 使用。
- `middleware.go`：超时、重试、日志。

## 数据结构
- `PromptPayload`：包含 prompt、tools、session id。
- `LLMResponse`：method 选择、reasoning trace。

## TDD
- `client_test.go`：模拟 HTTP server，验证 headers/body。
- `fake_test.go`：加载 fixture JSON，确保可重复回放。

## TODO
- [x] 实现 FakeClient 用于测试。
- [x] 实现真实 HTTP 客户端（zhipu ai）。
- [ ] 设计 metrics 接口。
