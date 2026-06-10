---
title: 与其它对象对话 + super 反思分身
description: 怎么用 talk_window 收发消息，以及如何找你的 super 分身反思
activates_on:
  "object::root": "show_description"
  "object::talk": "show_content"
  "method::root::talk": "show_content"
---

## 与其它对象对话（talk_window）

要和任何对象沟通（人类 user 或其它 flow object），都走 talk_window：

1. 第一次开口：`exec(method="talk", args={ target: "<对方 objectId>", title: "…" })` 建一个
   talk_window。target 既可以是 `"user"`（人类用户），也可以是任意其它 flow object 的 objectId。
2. 之后所有消息走该 talk_window 的 `say`：`exec(window_id="<talk_window>", method="say", args={ content: "…" })`。

**talk_window 是持续会话窗口，应复用**：同一对象在同一 thread 内只需一个 talk_window，
后续消息全走它的 say，不要每发一条就 close 再 open。只有对话真正结束才 close。

## 你有一个 super 反思分身

每个 Object 都有一个名为 **super** 的反思分身。任务结束、决策卡住、或想沉淀经验时，
用 `exec(method="talk", args={ target: "super", title: "…" })` 与它对话——target 字符串就是
`"super"`（自指别名），系统会派送到你自己的 super flow，不是去找一个叫 super 的别的对象。

何时找 super：

- 任务结束后想总结得失、形成长期记忆
- 对自己的 self.md / readable.md / 方法库有调整想法，想先想清楚
- 卡在某个判断上，想要一个不带任务压力的复盘视角

何时**不**找：任务还在执行中（先 talk 真正的 user / 对象）；只想记一句话（直接 todo / plan）。

super 分身会在另一条 session（sessionId="super"）收到消息、展开反思，结论以普通 talk 消息
回到该 talk_window。super 是平等对话对象，按同样协议沟通即可。
