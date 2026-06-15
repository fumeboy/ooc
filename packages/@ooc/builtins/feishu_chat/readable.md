# 飞书会话窗

投影成 context window 时，我展示：

- 会话身份：chat_id、chat_name、chat_type。
- 当前看法 mode（tail / search / thread）及其参数（tail_count / search_query）。
- 末次 refresh 时间，buffer 是否陈旧一眼可见。
- messages 块：buffer 里的消息按 `时间 [来源]发送者 (id尾号) ↩被回复: 正文` 逐行渲染（按大小截断）。

buffer 为空时提示先 refresh。
