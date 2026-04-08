---
name: kernel/computable/output_format
type: how_to_think
when: never
description: 线程树 TOML 输出格式规范 — 可用指令、字段说明、互斥规则、示例
deps: ["kernel/computable"]
---

# TOML 输出格式规范

## 格式概览

所有输出必须使用 TOML 格式。第一个非空白字符必须是 `[`。

| 段落 | 用途 |
|------|------|
| `[thought]` | 记录思考过程 |
| `[program]` | 执行代码 |
| `[talk]` | 向其他对象发送消息（异步，发完继续执行） |
| `[talk_sync]` | 向其他对象发送消息（同步，发完等待回复） |
| `[return]` | 完成当前线程，返回结果给创建者 |
| `[create_sub_thread]` | 创建子线程处理子任务 |
| `[continue_sub_thread]` | 向已创建的子线程追加消息（多次交互） |
| `[set_plan]` | 更新当前计划 |
| `[await]` | 等待某个子线程完成 |
| `[await_all]` | 等待多个子线程完成 |

## 创建者与返回

每个线程都有一个创建者（creator），在 Context 的「创建者」部分说明。

- 任务完成后，必须用 `[return]` 结束线程并返回结果
- `[talk]` 是异步发消息，不会结束线程。用 `[talk]` 通知别人后，线程继续执行
- 简单问答直接用 `[return]`，不需要 `[talk]`
- 不要用 `[talk]` 代替 `[return]`

## 各段字段说明

### `[thought]`
- `content` — 思考内容（必填，多行字符串）

### `[program]`
- `code` — 代码内容（必填，多行字符串）
- `lang` — 语言（可选）：`"javascript"` | `"shell"`，默认 `"javascript"`

### `[talk]`
异步发送消息，发完后继续执行当前线程。
- `target` — 目标对象名（必填）
- `message` — 消息内容（必填）

### `[talk_sync]`
同步发送消息，发完后暂停当前线程，等待对方回复。适合"问一个问题然后等答案"的场景。
- `target` — 目标对象名（必填）
- `message` — 消息内容（必填）

### `[return]`
- `summary` — 完成摘要（必填）
- `artifacts` — 产出物字典（可选）

### `[create_sub_thread]`
- `title` — 子线程标题（必填）
- `description` — 子线程描述（可选）
- `traits` — trait 名称数组（可选）
- `derive_from_which_thread` — 从哪个线程派生（可选，线程 ID）。不填则从当前线程派生。填写后子线程会继承目标线程的执行历史，可用于"向另一个线程提问"或"基于已完成线程的结果继续工作"。

### `[continue_sub_thread]`
向已创建的子线程追加消息。适合"子线程完成后需要追问或补充指令"的场景。
- `thread_id` — 目标子线程 ID（必填，必须是当前线程创建的直接子线程）
- `message` — 追加的消息内容（必填）

使用后当前线程自动进入 waiting，等待子线程再次完成。

### `[set_plan]`
- `text` — 新计划内容（必填）

### `[await]`
- `thread_id` — 等待的子线程 ID（必填）

### `[await_all]`
- `thread_ids` — 等待的子线程 ID 数组（必填）

## 互斥规则

1. 每轮输出只能包含一个主指令（`[return]`、`[create_sub_thread]`、`[continue_sub_thread]`、`[program]`、`[talk]`、`[talk_sync]` 选其一）
2. `[thought]` 可以和任何主指令并存
3. `[set_plan]` 可以和任何主指令并存
4. 任务完成后必须用 `[return]` 结束，不要无限循环

## 常见错误

1. 消息正文必须写在 `message = """..."""` 字段中，不能直接写在段后
2. 代码必须写在 `code = """..."""` 字段中
3. 字符串值必须使用引号 `"..."` 或多行字符串 `"""..."""`
4. 不要输出 `[finish]`、`[wait]`、`[break]` 等旧指令

## 示例

### 简单回答（直接返回给创建者）
```toml
[thought]
content = """
用户问了一个简单的问题，我可以直接回答。
"""

[return]
summary = "这里是对用户问题的回答内容"
```

### 执行代码
```toml
[thought]
content = "需要读取文件来获取信息"

[program]
code = """
const data = readFile("docs/gene.md");
return data;
"""
```

### 异步通知其他对象
```toml
[talk]
target = "kernel"
message = "请帮我检查一下 ThinkLoop 的实现"
```

### 同步询问其他对象（等待回复）
```toml
[talk_sync]
target = "sophia"
message = "G1 基因的最新定义是什么？"
```

### 创建子线程
```toml
[thought]
content = "这个任务需要分解为子任务"

[create_sub_thread]
title = "调研 G1 基因的历史演变"
description = "查阅 gene.md 和 discussions 目录，整理 G1 基因的演变过程"
```

### 基于另一个线程派生子线程（线程间对话）
```toml
[thought]
content = """
线程 th_abc123 已经完成了数据收集，我需要基于它的结果做进一步分析。
通过 derive_from_which_thread 创建一个派生子线程，它会继承目标线程的执行历史。
"""

[create_sub_thread]
title = "基于数据收集结果进行深度分析"
description = "分析 th_abc123 收集的数据，提取关键洞察"
derive_from_which_thread = "th_abc123"
```

### 向已完成的子线程追问（多次交互）
```toml
[thought]
content = """
子线程 th_xyz789 已经完成了搜索，但结果不够全面，需要补充。
用 continue_sub_thread 向它追加消息，它会被唤醒继续工作。
"""

[continue_sub_thread]
thread_id = "th_xyz789"
message = "请补充 2024 年之后的论文，特别关注 alignment 方向"
```

## 流式输出

输出顺序建议：
1. 模型先在原生 thinking 通道产生思考
2. assistant 输出 `[thought]`（可选）+ 主指令
3. 任务完成时输出 `[return]`
