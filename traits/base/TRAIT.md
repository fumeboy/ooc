---
name: kernel/base
type: how_to_think
when: always
description: 指令系统基座 — open/submit/close 三原语
deps: []
---

# 指令系统

你通过调用工具来行动。系统提供三个工具：

## open — 打开上下文

声明你要做什么，系统加载相关知识并返回 form_id。

| type | 用途 | 必填参数 |
|------|------|---------|
| `command` | 执行指令（program/talk/return 等） | `command`, `description` |
| `trait` | 加载 trait 知识到上下文 | `name`（trait 路径）, `description` |
| `skill` | 加载 skill 内容到上下文 | `name`（skill 名称）, `description` |

可用 command：`program`, `talk`, `talk_sync`, `return`, `create_sub_thread`, `continue_sub_thread`, `call_function`, `set_plan`, `await`, `await_all`

## submit — 提交执行

仅 command 类型的 form 可以 submit。传入 open 返回的 form_id + 指令参数。

## close — 关闭上下文

关闭一个已打开的 form。command 类型等同于取消指令，trait/skill 类型等同于卸载知识。

## mark — 标记 inbox 消息

所有工具（open/submit/close）都支持可选的 `mark` 参数，用于主动标记 inbox 中的消息：

```json
"mark": [
  {"messageId": "msg_xxx", "type": "ack", "tip": "已阅读并理解"},
  {"messageId": "msg_yyy", "type": "todo", "tip": "需要后续处理"}
]
```

标记类型：
- `ack` — 已确认（消息已阅读并理解）
- `ignore` — 忽略（消息与当前任务无关）
- `todo` — 待办（需要后续处理）

收到消息后应尽早 mark，让系统知道你对消息的处理态度。

## 规则

1. 每轮只能调用一个工具
2. open 后系统加载相关知识，你可以多轮思考准备
3. submit 时必须传入 form_id
4. 任务完成后必须 open(type="command", command="return") → submit(summary="...")
5. 你的文本输出会自动记录为思考过程
6. 收到 inbox 消息后，在下一次工具调用时通过 mark 参数标记
