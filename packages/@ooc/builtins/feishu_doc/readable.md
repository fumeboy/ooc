# 飞书文档窗

投影成 context window 时，我展示：

- 文档身份：doc_token、doc_kind、doc_title。
- 当前 mode（read / edit）与 content_format（markdown / blocks）。
- version_id（飞书 revision）、末次拉取时间。
- content 块：已 read 的文档正文（按大小截断）。

尚未 read 时 content 块提示先 read。

把我放进你的 context，我能为你做这些：

- `read`：把这个飞书文档的正文拉进来（markdown，或带 block id 的结构化形式）。
- `search_in_doc`：在我已 read 的内容里按关键字找行。
- `append`：在文末追加 markdown。
- `patch_block`：按 block_id 替换 / 在其后插入 / 删除某个 block。
- `share_link`：拿这个文档的可分享链接。
- `attach_to_chat`：把链接发到某个飞书 chat。
- `close`：用完把我收起来。

改文档类的能力（`append` / `patch_block` / `attach_to_chat`）都先 dry-run、要你确认才真改。
