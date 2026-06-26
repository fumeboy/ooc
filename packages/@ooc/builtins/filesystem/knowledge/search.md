---
title: search_window —— glob/grep 搜索结果
description: 一次 glob/grep 搜索的持久结果窗，可在某条匹配上打开文件
activates_on:
  "intent::class::search": "show_content"
---

search_window 持有一次 glob/grep 搜索结果（由 `filesystem` 成员的 `glob` / `grep` 创建）。

在它上面用 `exec(window_id="<search_window_id>", method="X", args={…})` 调：

- `open_match`（`index=N`）：在第 N 条匹配的路径上 spawn 一个 file_window（index 合法即可，
  不必在当前渲染视口内）。
- `set_results_window`：调整 matches 渲染视口（`matches_tail` 或 `matches_start`+`matches_end`）。
- `close`：关闭 search_window（不影响已 open 的 file_window）。

匹配列表 `matches` 每条含 index / path / line / snippet；超过 200 条会截断，只保留前 200 条。
