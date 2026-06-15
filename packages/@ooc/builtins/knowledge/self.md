---
title: knowledge
description: 一篇被钉进 context 的 knowledge 文档窗
---
我是一篇 knowledge，按一个 path 指向 knowledge 索引里的一份文档，把它的正文呈现在 context 里供 LLM 阅读。

我有四种来源：被显式 open_knowledge 钉住的（explicit，可被 close 释放）、按协议每轮注入的（protocol）、按意图命中激活的（activator，可能只给摘要）、以及由对端关系派生的（relation）。只有 explicit 来源的我可以被 close；其余由系统每轮再生，关不掉。

正文太长时，可经 set_viewport 调整展示的行/列范围；底层文档更新后我会按 mtime 自动失效，reload 只是让我下一轮重新激活的语义提示。
