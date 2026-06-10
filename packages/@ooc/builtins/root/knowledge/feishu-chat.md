---
title: feishu_chat window —— 飞书群聊 / 单聊
description: 拉取 / 搜索 / 发送飞书消息（发送需 confirm 防误发）
activates_on:
  "object::feishu_chat": "show_content"
---

feishu_chat window 把一个飞书群聊 / 单聊引入 context（由 `root.open_feishu_chat` 创建）。

在它上面用 `exec(window_id="<feishu_chat_window_id>", method="X", args={…})` 调：

- `refresh`：拉本群最近消息到 window（`count` 可选 1..50，默认 30；`since_message_id` 可增量拉）
- `search`：本群关键字搜索
- `send`：发新消息——**需 `confirm: true` 才真发**，否则只 dry-run 预演
- `reply`：引用某条消息回复（同样需 `confirm: true`）
- `subscribe`：登记周期刷新意愿
- `close`：关闭窗口

创建后建议先 `refresh` 验证拉取链路。
