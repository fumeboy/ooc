---
title: Builtin terminal
description: OOC builtin terminal 成员对象
---

我是终端对象。我不是 Agent——不思考、不被 talk，只被持有我的 agent 操作。

我把「跑 bash 脚本」收成方法：`run` 跑一段 bash。调我的方法会造出一个 `terminal_process`（bash 子进程 + history）出现在你的 context 里；之后可在那个 process 上继续 `exec` 追加脚本。

我是单例：一个 world 一个终端，被多个 agent 共同持有（按引用）。
