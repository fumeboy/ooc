---
name: kernel/talkable
type: how_to_interact
version: 1.0.0
when: never
command_binding:
  commands: ["talk", "talk_sync", "return"]
description: 对象间通信协议，talk/delegate/reply 消息传递
deps: ["kernel/computable"]
hooks:
  when_wait:
    inject: >
      在你 [wait] 之前，回顾一下你刚才执行的 actions：

      - 如果你已经用 talk() 回复了所有需要回复的消息（effects 中显示"已投递"），那就直接 [wait]，不要重复发送。

      - 如果你收到了来自其他对象的消息但还没有用 talk() 回复，先回复再 [wait]。

      - 如果你刚才写了 UI（写入了 ui/index.tsx）或生成了文档到 files/，你是否在 talk
        消息中包含了导航卡片？格式：[navigate title="标题"
        description="描述"]ooc://...[/navigate]。用户需要导航卡片才能方便地跳转查看。

      重复发送相同内容是严重的体验问题。
    once: true
  when_finish:
    inject: |
      在你 [finish] 之前，检查一下：你是否已经用 talk() 把任务结果发送给了请求者（user 或其他对象）？
      如果还没有发送结果，你必须先 talk() 给请求者，然后再 [finish]。
      如果你写了 UI 或文档，talk 消息中必须包含导航卡片：[navigate title="标题"]ooc://...[/navigate]。
    once: true
---

# 通信能力

## 发送消息

两种方式：

**方式一：`[talk]` 段格式**
```toml
[talk]
target = "user"
message = """
你的消息
"""

# 可选：如果这条 talk 是在回复某条未读 inbox 消息，建议同时标记已回复，避免重复回复
mark_message_ids = ["msg_xxx", "msg_yyy"]
mark_type = "ack"
mark_tip = "已回复"
```

**方式二：`talk()` 函数（在 program 中）**
```javascript
talk("你的消息", "对象名");
talk("回复内容", "user");        // 向人类回复
talk("收到，谢谢", "helper", "msg_abc");  // 回复特定消息
```

`talk()` 是同步投递（fire-and-forget），不需要 `await`。

## 回复特定消息

收到消息时系统会显示消息 ID（如 `#msg_xxx`），用 `reply_to` 字段或 `talk()` 第三参数指定回复哪条消息。

## 社交原则

- 只在任务需要时发消息，不寒暄
- 收到消息后回复对方需要的信息即可
- `talk()` 成功后不重复发送
- 完成所有工作后立即 `[wait]`
- 每次 `talk()` 有成本（消耗对方思考轮次）

## 相关 Traits

- `kernel/talkable/cross_object` — 跨对象函数调用协议
- `kernel/talkable/ooc_links` — ooc:// 链接和导航卡片
- `kernel/talkable/delivery` — 交付规范、协作交付、消息中断恢复
