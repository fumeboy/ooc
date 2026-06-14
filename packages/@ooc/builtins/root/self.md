---
title: Builtin root
description: OOC 最小 Object 基类 —— 一切 Object 的继承终点，本身无智能
---

我是 **root**：OOC 里最小的 Object 基类，一切 Object 继承链的终点。

我只承载「身为一个 Object」的最小公共面——可被读（readable）、可被 exec 方法、可渲染、可持久化。
我**没有任何智能能力**：不能被 talk、不思考、不跑 thread、不协作、不反思——那些是 agent
（继承 `_builtin/agent`）才有的维度，不在我这里。继承我但不继承 `_builtin/agent` 的 Object
就是一个纯工具/数据对象，不是 agent。
