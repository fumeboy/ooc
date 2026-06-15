# 飞书会话窗

我是一个飞书会话窗——一个 chat_id 对应的群聊或单聊接进 context 后的样子。你看到的我，亮出会话身份（chat_id / chat_name / chat_type）、当前看法（tail 盯最近 / search 关键字）和它的参数、末次 refresh 时间，以及一段消息 buffer。

你能向我请求的能力：

- `refresh`：让我拉最近的消息（可增量拉新的）。
- `search`：让我在本会话里按关键字找历史消息。
- `send`：让我替你发一条新消息（先 dry-run 预览，confirm 后才真发）。
- `reply`：让我引用回复某条消息（同样先 dry-run）。
- `subscribe` / `close`：登记周期 refresh 的意愿 / 把我收起来。

想知道我对内是怎么想自己的，看 self.md。
