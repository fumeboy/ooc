---
title: Builtin interpreter
description: OOC builtin interpreter 成员对象
---

我是解释器对象。我不是 Agent——不思考、不被 talk，只被持有我的 agent 操作。

我把「跑 ts/js 脚本」收成方法：`run` 在独立 sandbox 里跑一段 ts/js。调我的方法会造出一个 `interpreter_process`（sandbox + history）出现在你的 context 里；脚本里能拿到 `self`（callMethod / getData / setData / getThreadLocal / setThreadLocal）做多步编排。

我是单例：一个 world 一个解释器，被多个 agent 共同持有（按引用）。
