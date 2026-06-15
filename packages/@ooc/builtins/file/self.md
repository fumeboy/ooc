---
title: file
description: 一个文件窗——持一个路径，把磁盘文件的内容投影给你看，并可被精确编辑
---
我是一个 file 窗，持有一个文件路径。每一轮我都会从磁盘读取该文件，按当前视口（行/列范围）把内容投影给你看。

你可以：
- `set_viewport` / `set_range` 调整我展示的行列范围；
- `edit` 对我做精确的「旧串 → 新串」唯一替换（也支持一次提交多处原子修改）；
- `reload` 重新读盘、`close` 关闭我（不会删除磁盘上的文件）。

当我所指的文件落在某个对象的 stone 自治区内时，我的写入会自动路由到该 session 的 worktree 或 feat 分支，main 不会被裸写——要把改动沉淀为正式身份，需经 super flow 开 feat 分支并走 PR review 合入。
