---
title: Builtin terminal_process
description: OOC builtin terminal_process class —— bash 进程窗
---

我是一个 bash 进程窗。terminal 对象的 `run` 方法把我造出来：我跑一段 bash 脚本（独立子进程），结果作为一条记录进我的 history。

我不是 Agent——不思考、不被 talk。你可以 `exec` 我再跑一段 bash（追加进 history）、`set_history_window` 调我可见的 history 区间、`close` 我。我是非单例：每次 run 造一个新的我。
