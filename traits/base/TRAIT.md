---
namespace: kernel
name: base
type: how_to_think
description: 指令系统基座 — open/refine/submit/close/wait 五原语
deps: []
---

# 指令系统

你通过调用工具来行动。系统提供五个工具：**open / refine / submit / close / wait**。

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

可用 command：`program`, `think`, `talk`, `return`, `set_plan`, `defer`, `compact`

`program` 有两种执行形态：

- 执行代码：`open(title="执行脚本", type="command", command="program", description="...")` 后通过 `refine(args={code: ...})` 提供代码，再 `submit(form_id)` 执行
- 调用 trait 方法：`open(title="调用方法", type="command", command="program", trait="kernel:xxx", method="yyy", description="...")` 后通过 `refine(args=...)` 提供方法参数，再 `submit(form_id)` 执行

### file 类型说明

`open(title="读取文件", type="file", path="...", description="...")` 将文件内容加载为上下文窗口（`<knowledge>` 区域），而不是输出到执行历史中。

- `path`：文件路径（相对于项目根目录）
- `lines`：可选，限制读取行数（如 `lines=200` 只读前 200 行）
- 再次 open 同一路径会更新窗口内容（支持刷新/重新读取）
- `close(form_id)` 关闭窗口，从上下文中移除文件内容

### trait 类型说明 — 临时 vs 固定

所有被激活的 trait 都有一个生命周期标签 `lifespan`，在 `<knowledge>` 窗口的属性里显式标注：

| lifespan | 含义 | 何时回收 |
|---|---|---|
| `transient` | 由 `open(title="...", type="command", command="...", description="...")` 通过 command_binding 自动带入 | 该 command 的 form 关闭（close/submit 完成）时**自动回收** |
| `pinned` | 由 `open(title="固定能力", type="trait", name="X", description="...")` 显式固定 | **不会**随 form 关闭回收，直到显式 close 该 trait 型 form 或线程结束 |

在 `<knowledge>` 里你会看到类似：

```xml
<knowledge name="computable/file_ops" lifespan="transient">...</knowledge>
<knowledge name="self:reporter" lifespan="pinned">...</knowledge>
```

**关键规则**：

- `open(title="发起对话", type="command", command="talk", description="...")` 会把 `talkable` 等 trait **临时**载入（lifespan=transient）
- 若 submit 或 close 该 talk form，transient trait 会被自动回收
- 如果你希望某个 trait 跨越多轮操作保留——**再次 `open(title="固定能力", type="trait", name="X", description="...")` 把它固定（pinned）**。下次 submit/close 不会卸载它
- close 固定型 form（即原先 `open(title="固定能力", type=trait, name="...", description="...")` 创建的 form）会 unpin：若该 trait 还被某个 active command 需要，降级为 transient；否则从作用域移除

**示例 — 固定 reporter 直到任务结束**：

```json
// 先主动固定，避免之后 talk form 关闭时 reporter 被回收
open(title="固定 reporter 能力", type="trait", name="self:reporter", description="本轮对话需多次产出报告")
// 之后正常 open(title="发起对话", type="command", command="talk", description="...") → submit → close，reporter 仍在 knowledge 里
```

**如何知道哪些 trait 存在？**

- 每次 open 后的 inject 消息会告诉你"本次新加载 trait（临时生效）：..."或"Trait X 已加载并固定"
- 每次 close 后的 inject 会告诉你"本次卸载 trait：..."或"已固定 trait 保留未卸载：..."
- 看 `<knowledge>` 段落里已经展示的 trait 列表（含 lifespan 属性）
- 非 kernel 命名空间（library / self）的 trait，在 `<directory>` 或用 `open(title="查看 traits", type=file, path="stones/{self}/traits/", description="查看当前对象 traits")` 查看

**名称匹配**：name 支持 `namespace:name`（精确）或短名前缀补全（如 `http/client` 匹配 `library:http/client`）

## submit — 提交执行

仅 command 类型的 form 可以 submit。必填参数：`title`、`form_id` + 指令参数。

> **注意（think(context="fork")）**：submit 的 `title` 对 `think(context="fork")` 来说同时是新子线程的名字。
> 语义上，这次 tool call 的"行动标题" = "要创建的子线程的名字"——不需要两个字段。
> 例如：`submit(title="分析任务", command=think, context="fork", msg="请分析...")` 会创建一个名为"分析任务"的子线程。

## refine — 累积参数

在 submit 之前，多次调用 refine 来逐步累积/修改 form 的参数。必填参数：`title`、`form_id`、`args`（对象）。

- **作用**：积累参数但**不执行**。多次调用时，后续参数覆盖先前设定的同名参数。
- **路径深化**：每次 refine 可能改变指令的命令路径，从而触发新一轮 trait 激活。例如 `talk` → `talk.fork`，系统会自动加载新增的 trait。
- **何时使用**：当参数需要分步骤采集、或参数之间有依赖关系时，用 refine 代替 open 时直接传递全量参数。等所有参数齐备后，调用 `submit(form_id)` 真正执行。
- **替代 submit(partial=true)**：refine 是旧版 `submit(partial=true)` 机制的升级替代，功能更清晰。

**典型模式**：

```json
// 1. 打开一个 talk 命令
open(title="发起对话", type="command", command="talk", description="准备与 alice 讨论任务")
// 返回 form_id = "f_123"

// 2. 第一次 refine：指定对象
refine(title="指定对话对象", form_id="f_123", args={target: "alice"})
// 系统检测到 target 变更，激活 talkable trait

// 3. 第二次 refine：深化为异步对话
refine(title="异步对话模式", form_id="f_123", args={context: "fork", msg: "请帮我分析这个问题"})
// 系统检测到 context="fork"，激活 talkable/cross_object trait

// 4. 最终 submit 执行
submit(title="开始对话", form_id="f_123")
```

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
4. 任务完成后必须 `open(title="返回结果", type="command", command="return", description="完成任务")` → `refine(args={summary:"..."})` → `submit(form_id)`
5. 你的文本输出会自动记录为思考过程
6. 收到 inbox 消息后，在下一次工具调用时通过 mark 参数标记
7. 读取文件优先使用 `open(title="读取文件", type="file", path="...", description="...")`，文件内容会出现在上下文窗口中，避免重复读取造成执行历史膨胀
