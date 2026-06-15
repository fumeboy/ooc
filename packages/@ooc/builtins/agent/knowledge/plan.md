---
title: plan_window —— thread 的行动计划
description: 在 plan_window 上增删改 step、展开/收起 sub plan
activates_on:
  "object::plan": "show_content"
---

plan_window 是 thread 的行动计划窗口，由 agent 的 `plan` 方法创建 / 更新；支持 sub plan 嵌套，
也可经 `talk(target=自己)` fork 子线程时的 `share_windows` 共享给子 thread。

在 plan_window 上用 `exec(window_id="<plan_window_id>", method="X", args={…})` 调：

- `update_plan`：更新 plan 的 title / description
- `add_step`：追加 step（`text` 必填；`status` 可选，默认 pending）
- `update_step`：改某 step 的 text / status（`step_id` 必填）
- `expand_step`：把 step 展开为 sub plan_window（创建 child）
- `collapse_subplan`：反向，archive sub plan_window
- `mark_done`：标记 plan_window 自身完成
- `close`：关闭 plan_window（级联把所有 sub plan archived）
