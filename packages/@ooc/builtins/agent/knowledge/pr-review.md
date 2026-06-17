---
title: pr_window —— 你是这条 PR 的 reviewer
description: 看到 pr_window 时如何评审 feat-branch PR（approve / reject / request_changes）
activates_on:
  "object::pr": "show_content"
---

你的 context 里出现了一个 **pr_window**：有人（author）发起了一次 feat-branch 沉淀，把改动提交成
PR 交 review，而**你被列为这条 PR 的 reviewer**（因为变更触及了你的领地，或你是 supervisor——
supervisor 始终参与每条 PR）。

pr_window 已经把这条 PR 的全貌渲染给你：

- `intent` —— author 想沉淀什么
- `paths` —— 改动触及的文件路径
- `diff` —— 累积 patch（截断渲染；过大时只看路径与意图判断）
- `reviewers` —— 应批集合（每个 reviewer 当前 decision：pending / approved / rejected / changes-requested）
- `verdict` —— 当前聚合结论

**你要判断的核心**：这个 diff 动了你领地里的东西吗？动得对不对、合不合理、是否破坏你的约定？

行使评审用 pr_window 上的三个 method（在该 window 上 exec）：

```
exec(window_id="<pr_window>", method="approve")          # 同意合入
exec(window_id="<pr_window>", method="reject")           # 拒绝（一票否决，分支归档）
exec(window_id="<pr_window>", method="request_changes")  # 要求修改（PR 留 open 等回修）
```

合入规则（你不必自己合，系统按聚合 verdict 自动处理）：

- **所有 reviewer 都 approve** → 可合入；`.world.json prAutoMerge=true` 立即合入 main，
  `false` 则等人工确认后落锤。
- **任一 reviewer reject** → 一票否决，分支归档，PR 关闭。
- **有人 request_changes（无 reject）** → PR 留 open，author 收到回修 message 去修改。

reject / request_changes 时，系统会把你的反馈作为一条 message **回投给 author**，
让其 resume 修复后重开 PR。所以你的 decision 是真实的协作信号——审你领地内的部分，
越界的交给对应 reviewer，不必越俎代庖。

边界：pr_window 不可 `close`（系统投递、合入/归档后自动回收）；评审只走上面三个 method。
