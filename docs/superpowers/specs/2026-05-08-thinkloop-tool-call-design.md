# Thinkable Tool Call And Thinkloop Design

日期：`2026-05-08`

## 背景

当前仓库正在按 `goal.md` 的要求推进 OOC 系统重构。

现状：

- `src/thinkable/llm/` 已有统一 LLM client
- 当前 `llm` 只支持纯文本 `generate()` 与 `stream()`
- `meta/object/thinkable/thinkloop/index.doc.js` 已明确写出单轮流程：
  - `context-build -> llm -> tool-use -> 循环`
  - `result = await llmClient.chat(messages, { tools: getAvailableTools() })`
- 新系统还没有 `src/thinkable/thinkloop/` 实现

因此，本批次不是单独实现 `thinkloop`，而是要把下面这条最小主链一起收敛：

```txt
buildContext(thread)
  -> getAvailableTools(thread)
  -> llmClient.generate({ messages, tools })
  -> runThreadIteration(thread)
  -> dispatchToolCall(...)
```

如果不先补 `llm` 的原生 tool call 支持，`thinkloop` 就只能退回到“文本解析伪 tool call”的临时方案。
这个方案与当前 `thinkloop` 文档不一致，因此不采用。

## 目标

本次设计只解决以下问题：

1. 扩展 `src/thinkable/llm/`，让现有 `generate()` 与 `stream()` 支持原生 tool call
2. 在 `src/thinkable/thinkloop/` 下实现 `runThreadIteration(thread)` 这一层
3. 让 `thinkloop` 直接消费 `llm` 的原生 `toolCalls`
4. 用显式临时函数承接外围未迁移能力
5. 同步补齐 `llm` 与 `thinkloop` 的 `meta doc` 引用关系

## 非目标

本次设计明确不包含以下内容：

- scheduler 实现
- 多轮循环 orchestration
- thread tree 的完整运行时
- 真实持久化实现
- context-builder 的正式实现
- tool handler 的正式实现
- 文本解析 tool call 的过渡方案
- provider 专属配置层
- 多模态
- 通用 JSON Schema 类型系统
- 新增第三个 LLM 上层入口，例如 `chat()`
- 为“以后可能会有”的插件系统、容器系统、注册中心提前抽象

## 用户确认的约束

### 功能约束

- 不新增 `chat()`，直接在现有 `generate()`、`stream()` 基础上支持 tool call
- `thinkloop` 只实现 `runThreadIteration(thread)` 这一层
- `buildContext` 直接返回 `LlmMessage[]`
- `thinkloop` 是异步过程函数，不返回额外 result 对象
- `contextBuilder / 持久化 / pause 检查 / tool dispatch` 先接临时函数

### 代码质量约束

- 源代码必须使用中文注释
- 注释密度不低于每 5 行代码 1 行注释
- 避免过早抽象
- 不做防御性编程，保持逻辑干净、直接

### 文档约束

- 源代码与 `doc.js` 元文档之间必须建立引用关系
- 如果代码实现需要新的概念，而当前文档树中没有对应概念，必须先补文档
- 本批次允许同步更新 `llm` 与 `thinkloop` 的 `meta doc`

## 设计原则

### 1. 不增加第三个 LLM 入口

现有仓库已经有 `generate()` 与 `stream()` 两个入口。

如果为了 tool call 再新增一个 `chat()`，会把同一类能力拆成三种使用方式：

- `generate()`：纯文本
- `stream()`：流式文本
- `chat()`：文本 + tool call

这会增加上层心智负担，也会让 provider adapter 同时维护多套相近路径。

因此，本批次直接升级现有 `generate()` 与 `stream()` 的契约：

- `generate()` 返回完整文本和 `toolCalls`
- `stream()` 在流式文本事件之外，允许产出 `tool-call`

### 2. `thinkloop` 只做单轮编排

`runThreadIteration(thread)` 只负责编排一轮：

- 构建 messages
- 获取 tools
- 记录 LLM 输入
- 调用 LLM
- 记录 process events
- 记录 LLM 输出
- 检查 pause
- 顺序执行 tool call

它不承担：

- scheduler
- storage
- thread tree 管理
- tool 的具体业务逻辑

这些能力全部由显式依赖承接。

### 3. 临时缺口必须显式暴露

未迁移完成的外围能力不做“伪正式实现”，而是明确作为依赖传入：

- `buildContext`
- `getAvailableTools`
- `writeLatestLlmInput`
- `writeLatestLlmOutput`
- `isPausing`
- `dispatchToolCall`

这样可以保证：

- `thinkloop` 核心边界清晰
- 缺口不会被隐藏
- 未来接入正式实现时，只是替换依赖，不重写主流程

### 4. 数据模型只覆盖当前文档已定义内容

本批次只抽象：

- 文档中明确存在的 5 个 tool
- 文档中明确存在的 2 类 process event
- 当前 `llm` 已经实际支持的 provider：`openai` / `claude`

不提前引入“任意 tool 名”“任意事件名”“完整 JSON Schema 框架”等更大抽象。

## 目录设计

本批次落地后，目录结构调整如下：

```txt
src/
  thinkable/
    llm/
      index.ts
      types.ts
      env.ts
      client.ts
      providers/
        openai.ts
        claude.ts
      __tests__/
        env.test.ts
        openai.test.ts
        claude.test.ts
        client.test.ts
        real-openai.test.ts
    thinkloop/
      index.ts
      types.ts
      run-thread-iteration.ts
      __tests__/
        run-thread-iteration.test.ts
```

## `llm` 接口设计

### Provider

```ts
type LlmProvider = "openai" | "claude";
```

### Message

```ts
type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
```

第一批继续只支持纯文本消息，不扩展复杂 content block。

### Tool 定义

```ts
type LlmToolName = "open" | "refine" | "submit" | "close" | "wait";

type LlmTool = {
  name: LlmToolName;
  description: string;
  inputSchema: Record<string, unknown>;
};
```

说明：

- `LlmToolName` 先只允许 `thinkloop` 文档中定义的 5 个 tool
- `inputSchema` 先用 `Record<string, unknown>`，不提前抽象完整 JSON Schema 类型

### Tool Call

```ts
type LlmToolCall = {
  id: string;
  name: LlmToolName;
  arguments: Record<string, unknown>;
};
```

### 请求参数

```ts
type LlmGenerateParams = {
  provider?: LlmProvider;
  model?: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  temperature?: number;
  maxTokens?: number;
};
```

### 非流式结果

```ts
type LlmGenerateResult = {
  provider: LlmProvider;
  model: string;
  text: string;
  toolCalls: LlmToolCall[];
  thinking?: string;
  raw?: unknown;
};
```

说明：

- 没有 tool call 时，`toolCalls` 必须返回 `[]`
- `thinking` 是可选字段，provider 拿不到时不强行填空字符串

### 流式事件

```ts
type LlmStreamEvent =
  | { type: "start"; provider: LlmProvider; model: string }
  | { type: "thinking-delta"; text: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolCall: LlmToolCall }
  | {
      type: "done";
      text: string;
      toolCalls: LlmToolCall[];
      thinking?: string;
      raw?: unknown;
    };
```

### Client 接口

```ts
interface LlmClient {
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult>;
  stream(params: LlmGenerateParams): AsyncIterable<LlmStreamEvent>;
}
```

## `llm` provider 映射设计

### OpenAI 非流式

继续使用 `/chat/completions`。

请求映射：

- `messages` 直接传递
- `tools` 映射为：

```ts
tools: params.tools?.map((tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema
  }
}))
```

结果提取：

- 文本：`choices[0].message.content`
- tool calls：`choices[0].message.tool_calls`
- `arguments` 由 JSON 字符串解析成对象

### OpenAI 流式

继续使用 `/chat/completions` + `stream: true`。

最小归一化策略：

- 文本 delta -> `text-delta`
- thinking 不强行抽取，若 provider 无稳定字段则不产出
- tool call delta 在流内逐步聚合，等结构完整后产出 `tool-call`
- `done` 统一携带完整 `text` 与 `toolCalls`

### Claude 非流式

继续使用 `/v1/messages`。

请求映射：

- `system` 从 `messages` 中抽取
- 非 system 消息映射到 Claude message 数组
- `tools` 直接映射到 Claude 的 `tools`

结果提取：

- 文本：从 `content` 中所有 `text` block 拼接
- tool calls：从 `content` 中所有 `tool_use` block 提取
- `input` 直接作为统一 `arguments`

### Claude 流式

继续使用 `/v1/messages` + `stream: true`。

最小归一化策略：

- `content_block_delta` 的文本增量 -> `text-delta`
- `tool_use` block 完整出现时 -> `tool-call`
- `done` 统一携带完整 `text` 与 `toolCalls`

### 兼容策略

现有不带 `tools` 的调用方保持可用：

- `params.tools` 缺省时，按普通文本请求处理
- `toolCalls` 统一返回 `[]`

这保证现有 `real-openai.test.ts` 和文本相关调用不需要推翻重写。

## `thinkloop` 接口设计

### Process Event

第一批只落地文档中已出现的最小事件模型：

```ts
type ProcessEvent =
  | {
      category: "llm_interaction";
      kind: "text";
      text: string;
    }
  | {
      category: "llm_interaction";
      kind: "tool_use";
      toolName: LlmToolName;
      arguments: Record<string, unknown>;
    }
  | {
      category: "llm_interaction";
      kind: "thinking";
      text: string;
    }
  | {
      category: "context_change";
      kind: "inject";
      text: string;
    };
```

### ThreadContext

```ts
type ThreadContext = {
  id: string;
  status: "running" | "waiting" | "done" | "failed" | "paused";
  events: ProcessEvent[];
};
```

说明：

- 这里只表示 `runThreadIteration(thread)` 当前一轮真正需要的线程上下文
- 不提前塞入 children、inbox、node meta 等更大运行时结构

### ThinkloopDependencies

```ts
type ThinkloopDependencies = {
  buildContext(thread: ThreadContext): Promise<LlmMessage[]>;
  getAvailableTools(thread: ThreadContext): LlmTool[];
  writeLatestLlmInput(
    thread: ThreadContext,
    messages: LlmMessage[],
    tools: LlmTool[]
  ): Promise<void> | void;
  writeLatestLlmOutput(
    thread: ThreadContext,
    result: LlmGenerateResult
  ): Promise<void> | void;
  isPausing(thread: ThreadContext): Promise<boolean> | boolean;
  dispatchToolCall(
    thread: ThreadContext,
    toolCall: LlmToolCall
  ): Promise<void> | void;
  llmClient: LlmClient;
};
```

### 核心函数

```ts
async function runThreadIteration(
  thread: ThreadContext,
  deps: ThinkloopDependencies
): Promise<void>
```

说明：

- 它是异步过程函数
- 不返回额外 result 对象
- 所有效果通过 `thread` 变更与依赖副作用体现

## `runThreadIteration` 执行顺序

固定为以下 8 步：

1. 检查 `thread.status === "running"`
2. `messages = await buildContext(thread)`
3. `tools = getAvailableTools(thread)`
4. `await writeLatestLlmInput(thread, messages, tools)`
5. `result = await llmClient.generate({ messages, tools })`
6. 将 `result` 追加到 `thread.events`
7. `await writeLatestLlmOutput(thread, result)`
8. 检查 pause，若未 pause，则顺序执行 `dispatchToolCall`

### Process Event 追加规则

`thinkloop` 自身负责把本轮 LLM 输出写成 process events：

- `result.thinking` 有值时：
  - 追加 `llm_interaction/thinking`
- `result.text` 非空时：
  - 追加 `llm_interaction/text`
- 对每个 `result.toolCalls`：
  - 追加 `llm_interaction/tool_use`

这样可以保证：

- LLM 输出如何进入过程记录，是 `thinkloop` 的职责
- `dispatchToolCall` 不需要重复负责“记住 LLM 想调用了哪个工具”

### Pause 规则

pause 检查必须发生在：

- LLM 输出已记录之后
- tool call 执行之前

具体行为：

```ts
if (await deps.isPausing(thread)) {
  thread.status = "paused";
  return;
}
```

这样与现有文档保持一致：

- 用户可先看到并编辑记录下来的 LLM 输出
- resume 后再从后续步骤继续

## 错误处理设计

### LLM 调用失败

处理方式：

1. 捕获异常
2. 向 `thread.events` 追加一个 `context_change/inject`
3. `thread.status = "failed"`
4. 结束本轮

### Tool Call 失败

处理方式：

1. 捕获异常
2. 向 `thread.events` 追加一个 `context_change/inject`
3. 不把 `thread.status` 改为 `failed`
4. 立即结束本轮，不继续执行后续 tool call

这里选择“失败后立即停止本轮”，原因是：

- 逻辑更直接
- 更符合“让下一轮 LLM 决定如何处理错误”的文档意图
- 避免在一个已经部分失败的输出上继续执行剩余动作

## 测试策略

### `llm` 需要补的测试

1. OpenAI 非流式 tool call 提取
2. OpenAI 流式 tool call 归一化
3. Claude 非流式 tool call 提取
4. Claude 流式 tool call 归一化
5. `generate()` 在有 tools / 无 tools 两种情况下都能返回统一结构
6. `stream()` 的 `done` 事件能带回完整 `toolCalls`

### `thinkloop` 需要新增的测试

1. 正常路径
   - buildContext 被调用
   - getAvailableTools 被调用
   - llmClient.generate 被调用
   - text / tool_use 正确写入 `thread.events`

2. pause 路径
   - LLM 输出已记录
   - `thread.status` 被改为 `paused`
   - `dispatchToolCall` 不被调用

3. LLM 失败路径
   - 写入 `context_change/inject`
   - `thread.status = "failed"`

4. tool call 失败路径
   - 写入 `context_change/inject`
   - 线程不变成 `failed`
   - 当前失败后不继续执行剩余 tool call

### 真实链路测试

沿用当前 `real-openai.test.ts` 模式，允许增加显式开关控制的真实测试。

但第一批只要求保留一个真实文本链路测试，不强制新增真实 tool call 集成测试。

原因：

- 真实 tool call 会引入更多外部变量
- 当前目标是先验证统一协议与 thinkloop 主流程边界

## 需要同步更新的元文档

### `meta/object/thinkable/llm/index.doc.js`

需要从当前“文本 + 流式文本”的描述，升级为：

- 支持原生 tool call 的统一 LLM 门面
- 对应源码位置新增：
  - `src/thinkable/llm/types.ts`
  - `src/thinkable/llm/client.ts`
  - `src/thinkable/llm/providers/openai.ts`
  - `src/thinkable/llm/providers/claude.ts`

并在文档中明确：

- 通过现有 `generate()` / `stream()` 暴露 tool call 能力
- 不新增 `chat()`

### `meta/object/thinkable/thinkloop/index.doc.js`

需要补充：

- 当前第一批只实现 `runThreadIteration(thread)` 这一层
- 外围 `contextBuilder / 持久化 / pause / tool dispatch` 由临时函数承接
- 对应源码位置：
  - `src/thinkable/thinkloop/types.ts`
  - `src/thinkable/thinkloop/run-thread-iteration.ts`
  - `src/thinkable/thinkloop/index.ts`

## 实施完成标准

本批次完成后，至少满足：

1. 现有 `llm` 的 `generate()` / `stream()` 支持原生 tool call
2. OpenAI / Claude provider 都能把原生 tool call 归一化成统一结构
3. 存在 `src/thinkable/thinkloop/` 最小骨架
4. `runThreadIteration(thread)` 可直接消费 `generate({ messages, tools })`
5. 外围未迁移能力全部通过显式临时依赖承接
6. `llm` 与 `thinkloop` 的 `meta doc` 已同步更新并建立源码引用关系
7. 新增或修改的源码满足中文注释密度要求

## 风险与取舍

### 为什么不新增 `chat()`

因为这会把同一能力拆成三套入口，增加复杂度，而不是降低复杂度。

### 为什么不先做文本解析 tool call

因为这和当前 `thinkloop` 文档契约不一致，会制造新的临时概念。

### 为什么 `ThreadContext` 现在这么小

因为本批次只实现单轮执行器，不实现完整 thread runtime。
先把最小字段收紧，后续再按真实需要增量扩展。

### 为什么 tool call 失败后立即停止本轮

因为这是当前最简单、最稳定、最容易解释的策略。
如果未来真实场景证明需要“同轮继续”，那应该在文档中显式新增这条规则，再调整实现。
