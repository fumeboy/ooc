---
title: Reuse before introducing — solve problems with existing primitives first
date: 2026-05-17
category: conventions
module: src/executable/windows
problem_type: convention
component: architecture
severity: high
applies_when:
  - 提案"新增 window 类型 / 新增 OOC 原语 / 新增协议字段"前
  - 评审一份引入新概念的 spec / plan / PR
  - 看到自己写下"为了解决 X 我们需要新增 Y"——先停一下
tags: [ooc-architecture, simplicity, occam, entropy, design-discipline]
---

# Reuse before introducing — solve problems with existing primitives first

## Context

OOC 的核心叙事是 "上下文由一组 window 组成、LLM 用 5 个原语作用其上"。每多一种概念，
LLM 要多学一份语义、文档要多一段说明、回归要多一条边界——熵线性增加。但解决新问题
时，最常见的诱惑是"再加一种 window type / 再加一条新原语"。

具体引子（2026-05-17）：Bug 2"LLM 任务完成后忘 say/end，卡 wait"。我提出了一个
设计上很干净的方案——引入 `obligation` window：runtime 自动 spawn，wait 工具看到它
还 open 就硬错。技术上无瑕疵，但**多了一个 window type**。

用户的一句回问推翻了它："是否可以初始化一个 todo window 来解决这个问题"。

`todo_window` 早就在系统里了，本质就是"持续可见的待办"。obligation 想表达的事情，
todo 已经表达。差别只是名字朴素，但 LLM 看到的语义一致——一条 open 的待办在 context
里挂着，没办成就一直在。

最终方案是 spawn 一条 todo_window，0 个新概念。覆盖面与 obligation 等价。

## Guidance

提案任何"新增结构性概念"（window type / 原语 / event kind / 持久化字段）前，
按顺序问下面这些问题；任何一条能答"行"，就停在那一条：

1. **已有的 window type 能不能承载？**
   - 一条 todo 能不能表达？一个 do_window / talk_window 能不能复用？
   - 哪怕语义不是 100% 重叠，差 20% 是不是可以接受（让 todo 多承载一种 obligation 语义，
     比新建一个 obligation type 更经济）
2. **已有字段加一个可选属性能不能解决？**
   - 与其新增 window type，能不能给现有 window 加一个 `kind?: string` 之类的 tag？
   - 即使要加字段，也要先问"有没有现成字段能 hijack"。
3. **能不能用渲染层 / 工具层的小约束达成同效？**
   - 在 render 时把某条普通 window 标红 / 加 banner
   - 在 wait 工具的 pre-check 里加一行扫描
4. **新概念是不是只是"重命名"了已有概念？**
   - 如果新概念去掉名字之后跟某个旧概念几乎一样，那就是旧概念
5. **如果坚持要加新概念，新概念是否给未来开了 ≥2 个新的扩展点？**
   - 只为当前一个 bug 加结构性概念是最差的 trade-off
   - 至少能列出未来 2 个独立场景也会用到它，才值

只有以上 5 问都答"不行 / 必须"，再考虑新增概念。

## Why This Matters

新增概念的成本是**长期的、复利的**，而绝大多数时候被低估：

- **LLM 协议复杂度**：每多一个 window type 就要在协议 KNOWLEDGE 里讲一遍。文本越长越
  容易被 LLM 忽略，整体引导力反而下降（见 `llm-tool-handlers-fail-loud-2026-05-15.md`
  里同样的"信号过载"教训）
- **测试矩阵爆炸**：新 window type → 渲染单测 / 持久化单测 / 序列化往返单测 / 各种
  edge case
- **未来重构摩擦**：每个 window type 在 registry、render、persistable 都有触点。砍掉
  一种 type 比保留它贵 5 倍
- **概念预算**：用户 / 团队 / LLM 能记住的 OOC 概念数有上限。每多一种 window，剩余的
  概念预算就少一格，未来真正需要新概念时反而下不去手
- **"对的设计"≠"该加"**：obligation 方案设计上很干净，但 todo 复用方案更便宜、覆盖
  面相同。后者赢

反过来：复用已有概念把负载平摊到现成机制上，每个新需求都只在它最薄弱处加一行字段
或一段 hook，系统熵增速度 << 功能增长速度。这才是 OOC 长期可维护的关键。

## When to Apply

- **提案阶段**：写 spec / plan 时，新引入的任何"X 类型 / X 字段 / X 原语"段落都要先
  过一遍上面 5 问，结论写在 spec 里（写下来比想一遍更稳）
- **PR review**：看到 "+type X" / "interface X extends BaseY" / "新增 commandPath" 时
  问作者：能用现有 type 解决吗？
- **被 reviewer challenge 时**：默认认为 challenger 是对的，举证"必须新增"在你这一方
- **写代码时自己 catch**：当你写下"我们需要一种新的 X"，停一下，回到这份文档

## Examples

### 反例 — 引入 obligation window type（设计干净，但加了新概念）

```ts
// 假想的 src/executable/windows/types.ts
export interface ObligationWindow extends BaseContextWindow {
  type: "obligation";
  kind: "reply_to_creator" | "end_thread";
  talkWindowId?: string;
  messageId?: string;
  status: "open" | "fulfilled";
}
// 然后 registry、render、persistable 都要加一份；wait/say/end 工具加 pre-check / hook；
// 单测一套；文档一段；LLM 协议里多一段"obligation 是什么"…
```

技术上没问题，但代价是 OOC 概念数 +1，所有触点都要新增覆盖。

### 正例 — 复用 todo_window 承载相同语义

```ts
// 不动 types.ts。直接 spawn 一条 todo_window：
const replyTodo: TodoWindow = {
  id: generateWindowId("todo"),
  type: "todo",
  title: `回复创建者: "${initialMessage.slice(0, 40)}..."`,
  content: `回复创建者：${initialMessage.slice(0, 200)}`,
  status: "open",
  createdAt: Date.now(),
};
calleeThread.contextWindows.push(replyTodo);
```

LLM 看到的就是一条 todo（它早已认识 todo_window），content 文本清楚说明要回复什么。
完成后 LLM 自己 close（或后续 phase 做 auto-close hook）。**0 个新 window type，0 个新
字段，0 个新原语。** 与 obligation 方案覆盖面等价。

如果未来发现 todo 不足以表达更细的 obligation 语义，再升级——届时所有 obligation 都
是已经存在的 todo，迁移路径平滑。

## Related

- `src/executable/windows/types.ts` `TodoWindow` — 被复用的现成概念
- `src/executable/windows/types.ts` `WindowType` union — 新增 type 时唯一应改的地方；
  改它就是结构性新增的信号，应严格守门
- `docs/solutions/conventions/llm-tool-handlers-fail-loud-2026-05-15.md` — 同源教训：
  控制 LLM 信号面（少而精）比加规则更有效
- `meta/iteration.doc.js` § 阶段 9 ContextWindow 统一抽象 — OOC 自身就是把
  activeForms / windows / pinnedKnowledge 三种概念收敛成一种 ContextWindow 的故事；
  本约定是这种"收敛优于发散"哲学的日常运用
