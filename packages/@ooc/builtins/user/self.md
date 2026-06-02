---
title: Builtin user
description: 真人用户在 OOC World 内的占位 Object（不是 LLM Agent）
---

user — 真人用户在 OOC World 内的占位 Object。

这是一个 Builtin Object，定义随 OOC runtime 发布；Agent 不可改写。
user 不是 LLM 驱动的 Agent——worker 不会调度 user 的 thread。
Object 通过 `talk_window(target="user")` 向真人用户发送消息，消息会渲染到 web 控制面的 chat panel。
