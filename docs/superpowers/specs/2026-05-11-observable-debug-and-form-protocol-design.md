# Observable Debug And Form Protocol Design

**Goal:** 为 OOC 增加可开关的 debug 模式，按 ThinkLoop 轮次记录 LLM 输入/输出/元数据，并增强 form 协议可见性与纠偏提示，使 agent 能稳定生成正确的 `open/refine/submit` 序列。

**Scope**
- 扩展 `src/observable`：支持 debug 开关、轮次编号、loop 级 debug 文件、元数据记录。
- 扩展 `src/persistable`：支持 `loop_NNN.input.json` / `loop_NNN.output.json` / `loop_NNN.meta.json` 路径与写入。
- 扩展 `src/thinkable/thinkloop.ts`：显式记录每轮开始/结束时间、状态、错误，并把 debug 生命周期挂到单轮执行流程中。
- 扩展 `src/thinkable/context.ts` 与 `src/executable/tools/*`、`src/executable/commands/program.ts`：强化 form 协议约束与可见性。
- 更新文档与测试，重点覆盖 `meta-programming` 集成链路。

## Design

### 1. Debug Mode

`observable` 引入全局 debug 开关：
- `enableDebug()`
- `disableDebug()`
- `getDebugStatus()`
- `clearObservableDebugState()`

默认关闭。关闭时仍保留现有“最近一次 LLM 输入/输出快照”能力，兼容已有测试；开启时，若线程带 `persistence`，则额外写入 loop 级 debug 文件。

### 2. Loop-Level Debug Files

每个线程单独维护 loop 计数器。开启 debug 后，每轮 ThinkLoop 写入：
- `threads/{threadId}/debug/loop_0001.input.json`
- `threads/{threadId}/debug/loop_0001.output.json`
- `threads/{threadId}/debug/loop_0001.meta.json`

同时继续覆盖：
- `threads/{threadId}/debug/llm.input.json`
- `threads/{threadId}/debug/llm.output.json`

这样既能保留“最近一次快照”，也能复盘完整多轮历史。

### 3. Meta Record

`loop_NNN.meta.json` 记录结构化元数据：
- `threadId`
- `loopIndex`
- `provider`
- `model`
- `startedAt`
- `finishedAt`
- `latencyMs`
- `messageCount`
- `toolCount`
- `toolCallCount`
- `contextBytes`
- `resultTextBytes`
- `status`：`ok | paused | error`
- `error`：失败时写入错误信息

首版不实现 token usage、traits 统计、指令抽取，避免超出当前运行时可观测边界。

### 4. ThinkLoop Integration

`think()` 单轮执行流程改为：
1. 构建 context / tools
2. 调用 `observable.beginLlmLoop()` 记录输入与 meta 基础信息
3. 调 LLM
4. 记录 output
5. 若 pause，则补全 meta，状态写 `paused`
6. 顺序执行 tool calls
7. 若本轮异常，则补全 meta，状态写 `error`

这样 debug 生命周期与单轮执行强绑定，不依赖调用方补齐。

### 5. Form Protocol Stabilization

不引入“自动修正工具调用”的黑箱逻辑，改为增强协议显式性。

#### 5.1 Tool Descriptions

更新 `open/refine/submit` tool 描述：
- `open(type=command)` 只负责创建 form；业务参数必须放在 `args`，或后续通过 `refine(args={...})` 追加。
- `refine` 一律强调参数必须在 `args` 对象里，不接受把业务参数塞进顶层。
- `submit` 明确不接受业务参数，只消费已有 `form_id`。

#### 5.2 Active Form Visibility

在 `buildContext()` 的 `active_forms` 渲染中新增协议提示字段：
- `next_action`
- `protocol_hint`

规则：
- `open` form：`next_action=refine_or_submit_or_close`
- `executing` form：`next_action=wait_for_result`
- `executed` form：`next_action=inspect_result_then_close_or_open_next_form`

对 `program` form 再额外给出更强提示：
- 缺少 `language/code/function` 时，提示“先 refine(args={...})，再 submit”
- `function` 模式下提示 `args` 需要嵌套对象

#### 5.3 Command Feedback

`executeProgramCommand()` 的错误文本改为协议化纠偏提示：
- 空 `program` form 不只报“未知 language”
- 而是明确告知缺少哪些参数，以及下一步应该执行哪种 `refine(args=...)`

### 6. Success Criteria

- debug 开启时，可按轮次复盘每轮 LLM 输入/输出/元数据。
- debug 关闭时，不破坏现有 latest snapshot 与单文件落盘行为。
- `program` form 常见错误路径能收到结构化纠偏提示。
- `active_forms` 对下一步合法动作可见。
- `tests/integration/meta-programming.integration.test.ts` 稳定通过。

## Non-Goals

- 不实现 HTTP API 形式的 debug/pause 控制。
- 不实现 pause 后人工改写输出再 resume。
- 不实现自动把错误 tool call 改写成正确的 tool call。
- 不扩展到 token usage 等 provider 依赖字段。
