# 飞书文档窗

投影成 context window 时，我展示：

- 文档身份：doc_token、doc_kind、doc_title。
- 当前 mode（read / edit）与 content_format（markdown / blocks）。
- version_id（飞书 revision）、末次拉取时间。
- content 块：已 read 的文档正文（按大小截断）。

尚未 read 时 content 块提示先 read。
