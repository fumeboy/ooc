---
namespace: kernel
name: talkable
type: how_to_interact
version: 2.0.0
when: never
command_binding:
  commands: ["talk", "talk_sync", "return"]
description: 对象间通信协议 — talk/talk_sync 消息传递
deps: []
---

# 通信能力

## 发送消息

通过 `open(type=command, command=talk)` → `submit(target, message)` 发送异步消息。
通过 `open(type=command, command=talk_sync)` → `submit(target, message)` 发送同步消息（等待回复）。

talk 完成后，对方的回复会出现在你的 inbox 中，并附带 `[remote_thread_id: th_xxx]`。
这个 ID 是对方处理你请求的线程 ID，可用于后续继续对话。

## 继续对话（continue_thread）

如果你想在之前的对话基础上追问，使用 `continue_thread` 参数：

```
open(type=command, command=talk, description="继续向 sophia 追问")
submit(target="sophia", message="请补充 G3 的分析", continue_thread="th_xxx")
```

`continue_thread` 传入上次 talk 回复中的 `remote_thread_id`。
对方会在同一个线程中继续处理，保留之前的完整上下文。

不传 `continue_thread` 时，每次 talk 都会在对方创建新线程。

## 回复与 mark

收到消息时，Context 的"未读消息"区域会显示消息 ID（如 `#msg_xxx`）。
在下一次工具调用时通过 `mark` 参数标记消息：

```json
"mark": [{"messageId": "msg_xxx", "type": "ack", "tip": "已阅读并理解"}]
```

## 社交原则

- 只在任务需要时发消息，不寒暄
- 收到消息后回复对方需要的信息即可
- 不重复发送相同内容
- 每次 talk 有成本（消耗对方思考轮次）

## 子 trait

| 子 trait | 内容 |
|----------|------|
| `kernel/talkable/cross_object` | 跨对象函数调用协议 |
| `kernel/talkable/ooc_links` | ooc:// 链接和导航卡片 |
| `kernel/talkable/delivery` | 交付规范、协作交付 |
| `kernel/talkable/issue-discussion` | Issue 讨论（评论、@提及） |
