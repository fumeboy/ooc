---
title: Treat the LLM's perception surface as an API contract
date: 2026-05-17
category: conventions
module: src/thinkable + src/executable
problem_type: convention
component: llm-control-plane
severity: high
applies_when:
  - 设计 / 审视 OOC 原语（5 tool 原语 / window 注册的 command）的 schema
  - 设计向 LLM 暴露的 context / messages / events 渲染
  - 调研"LLM 偏离预期行为"类问题——开口先问"它看到的世界是不是完整且不撒谎"，再问"我有没有教它对的事"
tags: [llm-control-plane, contract-design, signal-integrity, structural-vs-coaxing]
---

# Treat the LLM's perception surface as an API contract

## Context

2026-05-17 一次集中迭代里连续遇到三个表面无关、根因同质的 LLM 行为漂移问题：

1. **wait 无 referent → 死锁**：`wait(reason)` 只要一个 free text；LLM 完成任务后直接
   `wait("done")` → thread 卡 waiting 永远没人唤醒。加 todo 提示 / 加协议决策树文本
   都只能把 OK 率从"偶发漂"提到"1/3 OK"。改成 `wait(on: window_id)` 要求显式指向
   IO 来源 window → S1 OK 率 3/3。
2. **Claude 看不到 tool 历史 → 跨轮丢失上下文**：OOC 把 inbox/inject 全映射 system
   role，`toClaudeMessages` 过滤后空了，每轮注入 "Continue based on the context
   above." 兜底。LLM 在 Claude 视角下看到的是"用户在每轮反复说 Continue，我不知道
   要继续什么"。改成把 function_call/function_call_output 正确编码成 Claude
   `tool_use` / `tool_result` content blocks，inbox 抽出来作 user message →
   integration tests 从 6/12 跳到 10/12 pass，并顺带带动 #3 改善。
3. **Phantom creator do_window → 假目标污染候选列表**：`initContextWindows` 在没有
   真 creator 信息时仍注入一个指向 `SESSION_CREATOR_THREAD_ID` 占位常量的
   do_window。新 wait 校验把它当合法候选，LLM `wait(on=<phantom>)` 通过校验 →
   永远等不到唤醒（占位 id 不会有人发消息）。

三个修复都不是"教 LLM 守规矩"，而是修了它感知到的"系统状态"的结构性正确性。

## Guidance

把 LLM 当成一个不能阅读你的 protocol 文档但严格按"它感知到的状态"行事的合作者。
它感知到的世界 = 系统给它的 tool schema + 渲染到 context 的内容 + 每轮 messages 数组。
这三层是 OOC 与 LLM 之间的**真正 API**；protocol KNOWLEDGE 是 README，不是契约。

每次设计 / 审视改动时跑三条 checklist：

### 1. 原语必须有 referent

任何能进 thread 状态机的原语（wait / close / submit / refine / ...）的 schema 都
要回答："如果你用这个原语，你在对哪个具体对象 / 哪个具体 form / 哪个具体事件源
做声明？"

- 这个 referent 必须是 schema 上的 required 字段（不是 optional reason text）
- referent 必须 resolve 到当前 context 里**实际存在**的实体
- 如果没有合法 referent，原语本身应该报 schema error 并枚举当前合法候选

错例：旧 `wait(reason: string)`——reason 是文档，不是 referent。任何状态都能合法 wait。
正例：新 `wait(on: window_id, reason?)`——on 是 referent，无合法 on 时 reject。

这条与 `llm-tool-handlers-fail-loud-2026-05-15.md` 互补：那一条管"输入格式错了
要响亮失败"，本条管"输入语义模糊的原语本身就不该存在"。

### 2. LLM 必须看见自己的历史

LLM 是 stateless 的——它每次调用只看你给的 input。如果它的 tool 历史在 input
里被丢失或扁平化，LLM 下一轮的连贯性会塌掉，表现为：

- 反复重复同一个无效操作
- 自言自语 "I don't have context to continue"
- 把过去的 tool 结果当成"新发现"

OOC 与 Claude 的接缝处之前会把 function_call / function_call_output drop 掉——
原因是 OOC 把所有"状态"打包到 system XML 上下文里。但 system XML 不是对话；
Claude 训练偏置认为"工作发生在 messages 里"，所以哪怕 system 里全写着，LLM 看到
messages 空（或反复同一句 Continue placeholder）时还是会迷失。

修法：每个 provider 的 transport 都要把 LLM 自己产生的 tool 调用 + 工具结果按
provider native 的格式回放回 messages 数组：
- OpenAI Responses API：function_call / function_call_output 直接进 input items
- Claude Messages API：assistant message 带 tool_use content block，user message
  带 tool_result content block

**不要靠 system 上下文复述 tool 历史代替 messages 数组里的 tool use 历史。**

### 3. 不要为"完整性"注入 phantom

系统里常有"为了所有 thread 都有 X 字段，没给 X 就用占位常量填"的代码。这种
phantom 看起来无害，但一旦下游有任何 validator 把它当合法目标，LLM 就会被引向
一个永远不会兑现的对象。

具体例子：`initContextWindows` 早期为了保证"每个 thread 都有 creator window"，
在没有真 creator info 时注入指向 `SESSION_CREATOR_THREAD_ID` 占位常量的
do_window。后来 wait 校验"open 的 do_window 是合法 IO 来源"——phantom 通过校验，
LLM 等它，永远等不到。

判定 checklist：

- 当你写"如果 X 缺，就用占位/默认 Y 填"，问：**Y 会不会被任何下游 validator 当成
  合法目标？** 会的话，要么不填（让 X 真的缺失，让校验器明确报错），要么把 Y
  做成永远不能通过 validator 的特殊形式（如 `__PLACEHOLDER__` 前缀 + 校验里
  显式 reject）。
- 对应 user-visible 状态时同理：UI 不要显示一个"看起来可以点但点了什么都不发生"
  的占位项；要么省略，要么明确灰掉并说明原因。

## Why This Matters

这条原则统辖了多种乍看不相关的"LLM 行为漂移"问题。如果只从单点修补，会陷入
无休止的 prompt 调整 / nudge 加码 / todo 提示等"软劝退"，治标不治本。

把"LLM 感知面"当成真正的 API：

- **可重现**：API 错误是确定性的，不需要靠 LLM 自觉
- **可测试**：可以 mock 一段 input 断言 LLM 必然能 / 不能做某事
- **可演进**：API 改 schema 是公开决策（spec/plan/changelog），protocol 文本调整
  是隐性 drift
- **可解释**：当 LLM 错时，能精确说"它看到的输入里哪一段引导了错误"，而不是
  "它没读懂第 N 段协议"

## When to Apply

- **设计新原语 / 新 command 时**：schema 上跑 checklist #1
- **新增 LLM provider / 改 provider transport 时**：跑 checklist #2
- **写 "every thread has X" / "every window must have Y" 的兜底逻辑时**：跑 #3
- **debug LLM 反复同样错误时**：先问"它看到的 input 是不是完整且诚实的"，再问
  "它有没有 capability"，**最后**才考虑"协议文本要不要加段"
- **被 reviewer challenge "为什么不再调一调 protocol KNOWLEDGE 文本"时**：把本
  文档贴过去

## Examples

### #1 referent 化

```ts
// 旧：wait 无 referent，是 "我不知道" 的兜底
{
  name: "wait",
  inputSchema: { properties: { reason: { type: "string" } }, required: ["reason"] }
}

// 新：wait 必须指明等的什么
{
  name: "wait",
  inputSchema: {
    properties: {
      on: { type: "string", description: "open 状态的 talk_window 或 do_window id" },
      reason: { type: "string" } // 可选，纯 observability
    },
    required: ["on"]
  }
}
// handler 内：on 必须 resolve 到合法 window，否则 reject 并枚举候选
```

### #2 让 LLM 看到自己的 tool 历史

```ts
// 旧：function_call / function_call_output 被 drop，messages 经常空
function toClaudeMessages(items) {
  return items.filter(item => item.type === "message" && item.role !== "system");
  // → drops all tool history; OOC 兜底注入 "Continue..."
}

// 新：按 Claude tool use 格式回放
function toClaudeMessages(items) {
  // 把连续同 role 的 items 合并成 content block 数组
  // function_call → assistant tool_use block
  // function_call_output → user tool_result block
  // role=system 且是 inbox 标记 → 抽出真实正文作 user text
  // 其它 role=system → 收到 system 字段
  ...
}
```

### #3 不要 phantom 填充

```ts
// 旧：没真 creator 也注入一个 phantom
function initContextWindows(thread, opts) {
  const creatorThreadId = opts.creatorThreadId ?? SESSION_CREATOR_THREAD_ID;
  thread.contextWindows.push({
    type: "do",
    targetThreadId: creatorThreadId, // ← 占位常量，下游验不出来
    isCreatorWindow: true,
    ...
  });
}

// 新：没真 creator 就不注入
function initContextWindows(thread, opts) {
  const hasRealCreator = opts.creatorThreadId !== undefined
    || thread.creatorThreadId !== undefined
    || thread.creatorObjectId !== undefined;
  if (!hasRealCreator) {
    // 让 contextWindows 真的没有 creator，下游验证器据此正确判断
    return;
  }
  ...
}
```

## Related

- `docs/solutions/conventions/llm-tool-handlers-fail-loud-2026-05-15.md` — "输入错了
  要响亮失败"；本约定把它扩展到 schema 层："输入语义模糊的原语本身不该存在"
- `docs/solutions/conventions/reuse-before-introducing-new-concepts-2026-05-17.md` —
  "复用现成概念"约定本身就是"少给 LLM 看新东西"的具体应用——本文档是它的元层
- `docs/superpowers/specs/2026-05-17-wait-requires-dependency-design.md` — 落地
  checklist #1 的 spec
- `src/thinkable/llm/providers/claude-transport.ts` — checklist #2 的实施
- `src/executable/windows/init.ts` — checklist #3 的实施
