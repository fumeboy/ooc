---
namespace: kernel
name: talkable
type: how_to_interact
version: 2.1.0
when: never
activates_on:
  paths: ["talk", "return"]
description: 对象间通信协议 — talk 统一 fork/continue 四模式
deps: []
---

# 通信能力

## talk —— 对其他对象的线程操作

`talk` 把 "给别人发消息" 的所有情形统一在一个指令下：

```
talk {
  target: string,                    # 目标对象名
  msg: string,                       # 消息内容
  threadId?: string,                 # 对方的线程 ID
  context: "fork" | "continue",      # 操作模式
  wait?: boolean,                    # true 时等待对方回复（阻塞当前线程）
  form?: <talk form>,                # 可选结构化表单
}
```

### 四种模式（+ wait 维度）

| 模式 | 表达 | 语义 |
|------|------|------|
| fork 对方新根线程（默认） | `talk(target=X, msg, context="fork")` | 对方开一条新会话处理你的请求 |
| fork 对方已有线程下的子线程 | `talk(target=X, msg, threadId=Y, context="fork")` | 在 X 的线程 Y 下派生子线程（新能力） |
| continue 对方已有线程 | `talk(target=X, msg, threadId=Y, context="continue")` | 向 X 的线程 Y 投递消息、唤醒它（新能力） |
| continue 无 threadId | **非法**（engine 会报错） | — |
| 任意模式 + wait=true | `talk(..., wait=true)` | talk 发出后当前线程进入 waiting，等对方通过 inbox 回复后被唤醒 |

> `wait=true` 对 `target="user"` 无效（user 不参与 ThinkLoop，永远不会唤醒），engine 会自动降级为普通 talk。

### 语义提示

- **fork**：派生新线程，对原线程 readonly。适合：发起新话题、询问意见、让对方另开一个任务帮你。
- **continue**：向对方已有线程投递消息、唤醒它。适合：追加信息、更正、在"同一个对话"里继续推进。

### 使用方式

```
# 新话题（fork 对方新根线程）
open(type=command, command=talk, description="请 sophia 分析 G3")
submit(title="请 sophia 分析 G3", form_id="<...>", target="sophia", msg="请分析 G3 的设计", context="fork")

# 在 sophia 的已有线程下派生子任务（fork under）
open(type=command, command=talk, description="在 sophia 的 G3 分析线程下派生子任务")
submit(title="派生子任务", form_id="<...>", target="sophia", msg="顺便看下 G3 的反例", threadId="th_sophia_g3", context="fork")

# 向对方已有线程补充信息（continue）
open(type=command, command=talk, description="向 sophia 补充数据")
submit(title="补充数据", form_id="<...>", target="sophia", msg="忘了告诉你：实验 009 的结论在附件", threadId="th_sophia_g3", context="continue")
```

talk 完成后，对方的回复会出现在你的 inbox 中，并附带 `[remote_thread_id: th_xxx]`。
你可以把这个 ID 作为下次 talk 的 `threadId` 参数，实现"在同一个对话里继续"（continue）或"在这个线程下派生"（fork）。

## target="super" —— 反思镜像分身（保留字）

> **反例警告**：不要把 `target="super"` 误解为 `target="supervisor"`——
> 前者是**你自己的反思通道**（把经验写给"未来的自己"），
> 后者是**独立的监督对象**（Alan Kay，系统的总指挥），它俩是完全不同的对象。

### 语义

`target="super"` 是一个保留字，指向**当前对象的 super**——即你自己的反思镜像分身（super-ego 的字面意义）。
消息落盘到 `stones/{你}/super/` 的独立线程树里，由你的 super 在后续时刻消费（沉淀 memory.md、创建新 trait 等）。

"A 对 super 说话" = "A 对自己说话"。

### 适用场景

- 记录一个值得沉淀的经验：`talk(target="super", msg="发现：X 场景下应该 Y", context="fork")`
- 让 super 派生一条反思线程去整理某段历史：`talk(target="super", msg="请把本次会话的教训整理成 memory 条目", context="fork")`
- 向已有的 super 反思线程追加新证据：`talk(target="super", msg="又一个反例：Z", threadId="th_super_yyy", context="continue")`

### 反例对比（必须分清）

| 写法 | 对象 | 后果 |
|------|------|------|
| `talk(target="super", msg="记下这个经验", context="fork")` | 自己的反思分身 | 落盘到 `stones/{你}/super/`，等你自己的 super 消费 |
| `talk(target="supervisor", msg="记下这个经验", context="fork")` | supervisor（Alan Kay） | 打断 Alan 的工作、让他帮你记——**绝大多数情况不是你想要的** |

当 prompt 里说"记下经验"、"向自己的 super 说"、"做反思"时——**永远用 `target="super"`**，不是 `target="supervisor"`。

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
  msg="这个需求你希望按哪种方式实现？",
  context="fork",
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
