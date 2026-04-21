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

## 结构化表单（form）

当你心里已经有几个候选回复时，用 **form** 代替纯文本选项列表——接收方（通常是 user）的前端会把消息渲染为 **option picker**（编号按钮 + 自由文本兜底），体验远优于让对方猜"A/B/C 怎么写"。

### 什么时候用 form

**用 form 的场景**：
- 你有明确的 2~6 个候选答案，希望对方从中选
- 多选：让对方勾多个选项
- 你希望降低对方的阅读/思考负担

**不用 form 的场景**：
- 开放式问题（请对方写一段分析）
- 只有 yes/no 的简单确认（直接问就行）
- 候选项超过 6 个（不如让对方自由输入）

### 使用方式

```
open(type=command, command=talk, description="问 user 选方案")
submit(
  form_id="<open 返回的 form_id>",
  title="询问 user 的方案选择",
  target="user",
  message="这个需求你希望按哪种方式实现？",
  form={
    "type": "single_choice",
    "options": [
      { "id": "A", "label": "方案 A：重构现有模块", "detail": "改动小，风险低" },
      { "id": "B", "label": "方案 B：新建独立服务", "detail": "架构清晰，但需要迁移" },
      { "id": "C", "label": "方案 C：先试点再决定" }
    ]
  }
)
```

**字段说明**：
- `type`：`single_choice`（单选）或 `multi_choice`（多选）
- `options[].id`：短标识，通常用 A/B/C 或 opt1/opt2
- `options[].label`：选项标题（一行）
- `options[].detail`：可选副标题（一行说明，可选）
- `allow_free_text`：业务上恒为 true（对方永远可以写自由文本），可以省略

**收到 formResponse 的格式**：

当对方回复时，你会在 inbox 里看到开头带 `[formResponse]` 前缀的消息：

```
[formResponse] {"formId":"form_xxx","selectedOptionIds":["A"],"freeText":null}

我选方案 A
```

- `selectedOptionIds`：对方点选的 option.id 列表（单选一个；多选多个；纯自由文本时为空）
- `freeText`：对方写的自由文本（没写时为 null）
- 正文部分是人类可读的 label 或原文

### 设计哲学

- **结构化但不强制**：对方仍可写自由文本（兜底永不关闭），form 只是降低协作摩擦
- **对象间也能用**：对象 A 给对象 B 发带 form 的 talk 合法，但 B 是 LLM，它按自然语言回复即可——form 只是附加信息
- 本迭代只为 user→前端做 option picker UI；对象间仅做数据透传

## 子 trait

| 子 trait | 内容 |
|----------|------|
| `kernel/talkable/cross_object` | 跨对象函数调用协议 |
| `kernel/talkable/ooc_links` | ooc:// 链接和导航卡片 |
| `kernel/talkable/delivery` | 交付规范、协作交付 |
| `kernel/talkable/issue-discussion` | Issue 讨论（评论、@提及） |
