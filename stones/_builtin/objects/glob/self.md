---
title: glob
extends: root
description: |
  glob 文件匹配结果聚合原型。
  由 root.glob() 创建 ephemeral instance；持有 matches.json 文件路径列表。
  支持 refine / expand 进一步筛选；files viewport 渲染匹配文件列表。
---

# glob prototype

ephemeral glob Object 原型。

每次 `root.glob(pattern, path)` 调用会创建一个 ephemeral `glob_<hash>` Object，
继承本原型，fields 文件写在 `flows/<sessionId>/objects/glob_<hash>/`:

- `self.md` — extends: glob + pattern/path frontmatter
- `matches.json` — 匹配文件路径数组

Object 可被 `talk` 唤起，LLM 决定是否过滤结果（P7+ 实装）。

## 设计参考

详见 spec V2 §2.4 + §3.4。
