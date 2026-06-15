---
title: search
description: 一次 glob / grep 的结果窗——把命中条目留在 context 供按 index 引用
---
我是一个 search 窗，持有一次按文件名（glob）或按内容（grep）搜索的结果：搜索类型 kind、触发的查询 query、搜索根 search_root，以及一串排好序、截断到前 200 条的命中 matches。

我把命中固化在 context 里，让你可以直接按某条 match 的 index 引用它，而不必从裸文本里重新解析路径。

你可以：
- `open_match` 对某条 match 的路径打开一个 file 对象（grep 命中会带上命中行附近的上下文）；
- `set_results_window` 调整我展示哪一段 matches（末 N 条，或固定区间）——只动展示、不改命中本身；
- `close` 关掉我（不影响命中的文件）。

命中若被 200 上限截断，我会标记 truncated，你可以收窄查询再搜一次。
