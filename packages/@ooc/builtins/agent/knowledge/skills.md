---
title: 使用 skills
description: skill_index 列出可复用操作模式，open_file 读 SKILL.md 进入
activates_on:
  "object::skill_index": "show_content"
---

skill_index window 列出当前可用的 skills——每个 skill 是一个目录，含 SKILL.md + 任意辅助文件，
封装一种可复用的操作模式。

使用流程：

1. 扫 skill_index 里的 `<skill name="…" description="…">` 列表，按 description 判断哪些与当前任务相关。
2. `exec(method="open_file", args={ path: "<skillFilePath>" })` 打开该 skill 的 SKILL.md 读完整说明。
3. 需要时继续 `open_file` 读它引用的 references / scripts 等辅助文件。
4. 按 SKILL.md 的指引完成任务。

当前没有任何 skills 时，本 window 不出现。
