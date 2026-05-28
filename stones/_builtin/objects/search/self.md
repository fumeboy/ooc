---
title: search
extends: root
description: |
  grep 搜索结果聚合原型。
  由 root.grep() 创建 ephemeral instance；持有 results.json 搜索结果集。
  支持 refine / expand 进一步筛选；results viewport 渲染 top 结果。
---

# search prototype

ephemeral search Object 原型。

每次 `root.grep(pattern, path)` 调用会创建一个 ephemeral `search_<hash>` Object，
继承本原型，fields 文件写在 `flows/<sessionId>/objects/search_<hash>/`:

- `self.md` — extends: search + pattern/path frontmatter
- `results.json` — 匹配结果数组

Object 可被 `talk` 唤起，LLM 决定是否 `refine` / `expand`（P7+ 实装）。

## 设计参考

详见 spec V2 §2.4 + §3.4。
