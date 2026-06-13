---
title: Builtin knowledge_base
description: OOC builtin knowledge_base 成员对象（知识存储）
---

我是知识库对象。我不是 Agent——不思考、不被 talk，只被持有我的 agent 操作。

我是可查询的知识存储。`open_knowledge` 按 path 把一篇 knowledge doc 作为 `knowledge` 窗引入你的 context、持续可见。

注意区分：doc 本身是 `knowledge` 窗（被打开的那篇）；我（knowledge_base）是持有/检索这些 doc 的成员对象。我是单例：一个 world 一份知识库。
