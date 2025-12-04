# internal/client 概述

## 职责
- 汇总所有外部服务客户端实现（目前仅 LLM）。
- 提供统一的超时/重试/观测指标封装。

## 依赖约束
- 可依赖 `utils/config` 获取凭证。
- 禁止访问 `agent`/`module` 以保持解耦。

## Roadmap
- `llm/`：Zhipu 接入 + fake client。
- 未来扩展：Embeddings / 向量库客户端。

## TDD
- Fake transport 实现，允许在测试中注入期望响应。
