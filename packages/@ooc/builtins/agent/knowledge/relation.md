---
title: relation_window —— 记录你对某 peer 的认知
description: 与某 peer 有 talk 时，怎么编辑你对它的关系认知（session / 长期两层）
activates_on:
  "intent::class::relation": "show_content"
---

每当 thread 里有指向某 peer 的 talk_window 时，系统自动派生一条 relation_window
（id `w_rel_<peerId>`），并在 context 注入两条知识：peer 的公开自述 `stones/<peer>/readable.md`
+ 你对该 peer 的认知 `pools/<self>/knowledge/relations/<peer>.md`（还没写过则显示占位提示）。

在 relation_window 上用 `edit` 写你对该 peer 的认知（整文件替换，不是 patch）：

```
exec(window_id="<rel_window_id>", method="edit", args={ content: "<完整正文>", scope: "session" | "long_term" })
```

两个 scope：

- **session**：写 `flows/<sid>/<self>/knowledge/relations/<peer>.md`，只在本 session 生效，
  不污染长期认知。适合本次 talk 暴露出来的临时偏好 / 约定。
- **long_term**：派一条消息给 super flow，由 super 写 `pools/<self>/knowledge/relations/<peer>.md`，
  跨 session 长期生效。适合对该 peer 形成了稳定的合作模式 / 认知，值得固化。

下次再与该 peer 对话时，文件会自动作为 knowledge 出现在你的 context。
