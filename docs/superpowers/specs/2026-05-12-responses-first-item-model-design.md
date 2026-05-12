# Responses-First Item Model Design

**日期：** 2026-05-12

## 目标

将 OOC 的 LLM 上下文构造从 `messages-first` 重构为 `Responses-first item model`，以 OpenAI Responses API 协议作为内部真相模型，不考虑旧 `chat/completions` 兼容。

同时明确 `user_input` 表达规则：

1. 进入 `thread.inbox`，生成带 `msg_id` 的新消息；
2. 在 `events` 中新增一条 `context_change` 事件，显式说明“有新消息到达”，并引用该 `msg_id`。

## 设计边界

### In Scope

- 内部 LLM 输入/输出模型改为 item 流（不是 role-only message 列表）
- OpenAI provider 改用 `POST /v1/responses`
- thinkloop 按 item 驱动 tool call / tool output 链路
- debug 落盘改为 item 形态（input/output）
- `user_input` 统一通过 inbox + context_change(msg_id) 机制表达

### Out of Scope

- 不做旧格式兼容层
- 不做历史 debug 文件自动迁移
- 不保留 `chat/completions` 运行路径

## 核心问题（现状）

当前模型问题：

1. `LlmMessage` 仅有 `system/user/assistant`，无法表达 `function_call` 与 `function_call_output` 的一等语义。
2. tool 调用过程不在 message 主链路中，依赖 `inject` 文本回执补偿。
3. `context_change/inject` 承担过多语义（用户输入、系统回执、工具错误、生命周期提示混杂）。
4. provider 层仍按 Chat Completions 形态组织请求，难以对齐 Responses API 新协议。

## 目标协议：Item-First

新增统一 item 抽象（命名可在实现阶段微调）：

```ts
type LlmInputItem =
  | { type: "message"; role: "system" | "user" | "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: LlmToolName; arguments: Record<string, unknown> }
  | { type: "function_call_output"; call_id: string; output: string; name?: LlmToolName }
  | { type: "reasoning"; text: string };
```

> 说明：OpenAI Responses 的真实对象字段会在 provider 层按 API 规范映射；内部模型保持可测试、可调试的稳定结构。

## user_input 规则（你确认的版本）

用户输入不再直接写成 `inject` 文本消息；统一走两步：

1. **Inbox 入站**：
   - 写入 `thread.inbox` 一条 `ThreadMessage`
   - 必须具备稳定 `id`（msg_id）
2. **Event 通知**：
   - `thread.events` 追加 `context_change` 事件
   - 事件内容必须包含该 `msg_id`
   - 语义是“新输入到达，可消费”

建议事件形态：

```ts
{
  category: "context_change",
  kind: "inbox_message_arrived",
  msgId: "msg_xxx",
  text: "可选摘要"
}
```

## XML System Prompt 保留策略

保留 XML system prompt，但语义收敛：

- system 只承载稳定状态与结构化上下文（thread/meta/forms/knowledge/inbox/outbox）
- 不再承担工具调用链回放职责
- `context_change` 只作为“状态变化通知信号”，不再充当工具执行结果主体

## 消息构造：由 buildContext 变为 buildInputItems

### 旧逻辑

- `buildContext(thread) -> LlmMessage[]`
- 产物：`system(xml) + transcript(messages)`

### 新逻辑

- `buildInputItems(thread) -> { instructions?: string; input: LlmInputItem[] }`
- `system xml` 作为 item（或 instructions + system item 组合）
- tool 调用链由 item 直接表达，不通过 inject 文本补丁

## thinkloop 重构

新流程：

1. `buildInputItems(thread)`
2. `llmClient.generate({ inputItems, tools, instructions? })`
3. 解析 `output_items`
4. 对 `function_call` 执行工具
5. 将工具结果写回 `function_call_output` item（并记录事件）
6. 进入下一轮调度决策

关键要求：

- tool call 与 tool output 必须通过 `call_id` 配对
- tool 失败也要产出结构化 output（error shape），不再只写 inject 文本

## OpenAI Provider 升级（强制）

`src/thinkable/llm/providers/openai.ts` 从 `chat/completions` 切到 `responses`：

- endpoint: `/v1/responses`
- 请求主字段：`model`, `input`, `tools`, `instructions`, `store`
- 输出解析：读取 `output` item 列表（message/reasoning/function_call）
- 使用 `function_call` + `function_call_output` item 协议，而非旧 `message.tool_calls`

`store` 策略：

- 默认 `store: false`（与当前本地调试型架构一致，避免服务端状态耦合）

## Claude Provider 策略

内部仍走 item 模型；Claude provider 作为协议适配层：

- item -> Claude 请求体（messages/system/tools）
- Claude 响应 -> 统一 output items

> 重点：内部主干是 item，provider 差异在边缘层消化。

## 事件模型调整

建议新增/替换事件类型（示意）：

```ts
type ProcessEvent =
  | { category: "llm_interaction"; kind: "assistant_message"; text: string }
  | { category: "llm_interaction"; kind: "function_call"; callId: string; name: LlmToolName; arguments: Record<string, unknown> }
  | { category: "tool_runtime"; kind: "function_call_output"; callId: string; name: LlmToolName; output: string; ok: boolean }
  | { category: "context_change"; kind: "inbox_message_arrived"; msgId: string; text?: string }
  | { category: "context_change"; kind: "state_notice"; text: string };
```

## Debug 落盘升级

`llm.input.json` / `loop_XXXX.input.json` 改为记录：

- `instructions`
- `input_items`
- `tools`

`llm.output.json` / `loop_XXXX.output.json` 改为记录：

- `output_items`
- `provider`
- `model`
- 关键元数据（耗时、status）

这样人工检查时可直接看到完整工具调用链。

## 验证标准

1. 单轮 tool 调用可在 input/output debug 中看到完整链：
   - `function_call`
   - `function_call_output`
2. `user_input` 只通过 inbox + context_change(msg_id) 表达，不再直接伪造 inject user 文本。
3. OpenAI provider 不再访问 `/chat/completions`。
4. XML system prompt 仍存在且结构正确。
5. 关键测试通过：
   - context/buildInputItems
   - thinkloop tool 链路
   - openai provider responses parsing
   - debug file schema

## 风险与对策

### 风险 1：一次性切换导致回归范围大

对策：

- 先在类型层锁定 item 模型
- 先改测试再改实现（TDD）
- 以 debug 文件断言作为核心回归哨兵

### 风险 2：tool output 字段不稳定

对策：

- 定义统一 `function_call_output` payload 规范（success/error）
- 工具层统一通过 helper 生成 output 字符串，避免各 tool 各写各的

### 风险 3：Claude 适配语义漂移

对策：

- provider contract 测试：同一输入 item 在 openai/claude 下的归一化输出语义一致

## 结论

本方案采用 **Responses-first item model** 作为内部主干语义，直接替换旧 message-only 构造，不做兼容负担。  
这样可以把工具调用链、用户输入到达、系统状态变化都表达为结构化的一等对象，调试与推理语义一致，后续扩展能力更稳。
