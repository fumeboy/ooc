# Agent 内核 (internal/agent)

## 职责
- 定义 Info/Method/Conversation/Activity/Registry 的具体 struct。
- 实现思考循环：AssembleContext → LLM → ApplyResult。
- 管理 Focus/Ask/Respond/Further Talk 等特殊 Method。

## 关键数据结构
- `InfoI`、`MethodI`：核心接口定义（参考 meta.md），InfoI 需实现 `ID()`（返回带 class 前缀的完整 ID）。
- `ConversationState`：追踪对话上下文与 activity 历史，支持 `Parent` 将追问会话挂载到父会话。
- `Registry`：保存所有 Info/Conversation/Activity 引用，提供引用计数和订阅。

## 模块化策略
- 通过 `module.Manager` 注册 Info → 自动注入方法表。
- Activity 执行通过接口 `MethodExecutor` 回调模块，现在直接调用 `MethodI.Execute`。

## 核心实现
- `ConversationEngine`：实现思考循环（Think/ThinkLoop），支持普通 Conversation 和 Action 模式。
- `conversationSystemPrompt`：提供系统级提示，描述 Conversation 机制与 Respond/Talk/Ask/Focus 方法，作为 system message。
- `Conversation.Prompt`：组装当前对话上下文（对象信息、引用、请求内容、历史 Activities），作为 user message。
- `applyResult`：处理 Respond/Talk/Ask/Focus 等特殊方法，以及执行具体方法。
- `executeMethod`：判断如果是 Action 模式且 method 匹配，则直接执行；否则创建新的 Activity。

## 文件结构
- `agent.go`：核心数据结构定义（InfoI、MethodI、ConversationState）。
- `registry.go`：Registry 实现，管理 Info/Conversation/Activity 的生命周期。
- `conversation.go`：ConversationEngine 实现，支持普通 Conversation 和 Action 模式。
- `conversation.talk.go`：Talk 特殊方法处理。
- `conversation.ask.go`：Ask 特殊方法处理。
- `conversation.focus.go`：Focus 特殊方法处理。

## TDD
1. `registry_test.go`：对象注册/释放/引用计数。
2. `conversation_test.go`：基础对话思考循环测试。
3. `conversation_special_test.go`：Ask/Focus 特殊方法测试。

## TODO
- [x] 完成 Registry 结构与基础测试。
- [x] 实现 Conversation 思考循环（AssembleContext → LLM → ApplyResult）。
- [x] 实现 Activity 执行流程（参数解析 → 方法执行）。
- [x] 实现 Talk/Ask/Focus 特殊方法。
- [x] Activity 完全复用 Conversation 的能力，只重写 assembleContext。
- [x] MethodI 增加 Execute 方法，直接通过方法实例执行。
- [ ] 定义上下文快照格式，用于故障恢复。
