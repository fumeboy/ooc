# 我是一个飞书会话窗

我把一个飞书群聊或单聊接进你的 context。一个 chat_id 对应一个我；你和这个会话的来往都经过我。

我手里有这个会话的一段消息 buffer，默认拉最近 30 条。我有三种看法：

- `tail`：盯最近 N 条，随时 `refresh` 拉新（可带 since_message_id 增量拉）。
- `search`：在本会话里按关键字找历史消息，临时切到这个看法。
- `thread`：围绕某条消息看它的回复。

我能替你发言：`send` 发新消息、`reply` 引用回复某条。**发言一定先 dry-run**——第一次提交我只预览不真发，你看过没问题、`refine(args={ confirm: true })` 再 submit 我才真的发出去。发言默认用机器人身份（as=bot），需要时可改 as=user。

`subscribe` 让我登记一个周期 refresh 的意愿（poller 还没接，现在仍需你显式 refresh）。看够了用 `close` 把我收起来。

我不直接碰飞书凭证——所有对飞书的调用都走 lark-cli，鉴权由 lark-cli 自己管（OS keychain / OAuth）。如果你看到鉴权未就绪的错误，去终端跑 `lark-cli config init` + `lark-cli auth login`。
