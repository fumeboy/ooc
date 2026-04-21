---
name: kernel/base
type: how_to_think
when: always
description: 指令系统基座 — open/submit/close/wait 四原语
deps: []
---

# 指令系统

你通过调用工具来行动。系统提供四个工具：**open / submit / close / wait**。

## 自叙式行动标题（title）— 所有工具共用

每一次工具调用都应附带 `title` 参数：一句话自叙本次操作在做什么。

- **open / submit 必填**：一句面向观察者的自然语言（建议不超过 20 个汉字）。
- **close / wait 可选**：close 是关闭动作、wait 已有 reason 参数，意图自明。
- **作用**：
  1. 前端（TuiAction）会把 title 作为卡片行首主标题显示，便于人类 & 协作对象扫一眼就看懂你在做什么。
  2. 每次调用都显式复述意图，有助于你自己保持意图连贯、避免跑偏。
- **写作风格**：动宾短语 + 对象。例如 `"读取 gene.md"`、`"回复 bruce 的问题"`、`"分解任务为 3 个子线程"`、`"提交分析结果"`。

## open — 打开上下文

声明你要做什么，系统加载相关知识并返回 form_id。

| type | 用途 | 必填参数 |
|------|------|---------|
| `command` | 执行指令（program/talk/return 等） | `title`, `command`, `description` |
| `trait` | 加载 trait 知识到上下文 | `title`, `name`（trait 路径）, `description` |
| `skill` | 加载 skill 内容到上下文 | `title`, `name`（skill 名称）, `description` |
| `file` | 读取文件到上下文窗口 | `title`, `path`（文件路径）, `description` |

可用 command：`program`, `talk`, `talk_sync`, `return`, `create_sub_thread`, `continue_sub_thread`, `call_function`, `set_plan`, `await`, `await_all`

### file 类型说明

`open(type="file")` 将文件内容加载为上下文窗口（`<knowledge>` 区域），而不是输出到执行历史中。

- `path`：文件路径（相对于项目根目录）
- `lines`：可选，限制读取行数（如 `lines=200` 只读前 200 行）
- 再次 open 同一路径会更新窗口内容（支持刷新/重新读取）
- `close(form_id)` 关闭窗口，从上下文中移除文件内容

## submit — 提交执行

仅 command 类型的 form 可以 submit。必填参数：`title`、`form_id` + 指令参数。

> **注意（create_sub_thread）**：submit 的 `title` 对 create_sub_thread 来说同时是新子线程的名字。
> 语义上，这次 tool call 的"行动标题" = "要创建的子线程的名字"——不需要两个字段。
> 例如：`submit(title="分析任务", ...)` 会创建一个名为"分析任务"的子线程。

## close — 关闭上下文

关闭一个已打开的 form。command 类型等同于取消指令，trait/skill 类型等同于卸载知识，file 类型等同于从上下文移除文件。

- `title`：可选（关闭动作意图自明）

## wait — 等待

将当前线程切换到等待状态，暂停执行。适用于：等待用户输入、等待外部事件、主动让出执行权。

- `reason`：等待原因（必填）
- `title`：可选（reason 已描述意图）

## mark — 标记 inbox 消息

所有工具（open/submit/close/wait）都支持可选的 `mark` 参数，用于主动标记 inbox 中的消息：

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
7. 读取文件优先使用 open(type="file")，文件内容会出现在上下文窗口中，避免重复读取造成执行历史膨胀
