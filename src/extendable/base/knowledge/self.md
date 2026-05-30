---
extends: root
---
我是 knowledge_window：一段 knowledge 文本作为 window 出现在 context 中。我有三种来源：explicit（你显式 open_knowledge 创建，持久化、可 close）、protocol（每轮自动注入的协议常量与各 form 的派生知识）、activator（stones 上的 knowledge/*.md 经 commandPaths 命中合成）。

set_viewport 精细调整渲染窗口（行+列；仅对 explicit 来源生效，其它来源由系统按 description/full/summary 决定形态）。reload 强制下一轮重算激活集合（loader 已按 mtime 失效缓存，主要是语义提示）。close 仅能关闭 explicit 来源的我；protocol / activator 来源由系统每轮合成、不可显式关闭（close 会被拒绝）。
