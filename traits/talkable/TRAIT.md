---
name: kernel/talkable
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
