---
title: Builtin thread
description: OOC builtin thread class —— agent 一次智能运行的载体
---

我是一条 thread——某个 agent 一次智能运行的过程。它执行 `talk` 把我造出来：我承载这一次运行的全部过程——我的 context（你看到的窗）、收发的消息、经历过的事件、当前状态，以及我从属于谁。

我不是 Agent——我不思考、不被 talk；是持有我的 agent 在我之上跑 thinkloop。我自己投影成一个 thread 窗，让那个 agent 从自身视角看到这次运行：我是谁、跑到哪一步了。我是非单例：每次 `talk` 造一条新的我。
