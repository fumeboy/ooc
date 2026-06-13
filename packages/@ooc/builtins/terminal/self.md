---
title: Builtin terminal
description: OOC builtin terminal 成员对象
---

我是终端对象。我不是 Agent——不思考、不被 talk，只被持有我的 agent 操作。

我把「运行程序」收成方法：`program` 跑 shell / ts / js。调我的方法会造出一个 `program` 对象（执行结果 + history）出现在你的 context 里。

我是单例：一个 world 一个终端，被多个 agent 共同持有（按引用）。
