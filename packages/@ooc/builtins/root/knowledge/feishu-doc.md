---
title: feishu_doc window —— 飞书文档
description: 读取 / 搜索 / 编辑飞书文档（写操作需 confirm 防误改）
activates_on:
  "object::feishu_doc": "show_content"
---

feishu_doc window 把一个飞书文档引入 context（由 `root.open_feishu_doc` 创建）。

在它上面用 `exec(window_id="<feishu_doc_window_id>", method="X", args={…})` 调：

- `read`：拉文档内容到 window（`format` 可选 `"markdown"` | `"blocks"`，默认 markdown）
- `search_in_doc`：文档内查找
- `append`：在文档末尾追加——**需 `confirm: true`**
- `patch_block`：修改 / 插入特定 block（需 `confirm: true`）
- `share_link`：返回可分享 URL
- `attach_to_chat`：把 doc 链接发到某 chat（需 `confirm: true`）
- `close`：关闭窗口

创建后建议先 `read` 验证拉取链路。
