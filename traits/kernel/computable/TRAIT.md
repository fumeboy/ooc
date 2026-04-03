---
namespace: kernel
name: computable
type: how_to_think
version: 1.0.0
when: always
description: 认知栈思维模式 — 用行为树结构化你的思考过程
deps: ["kernel/output_format"]
hooks:
  before:
    inject: |
      你刚进入一个新的任务节点。在开始执行之前，先评估：
      - 这个任务是否包含多个逻辑独立的步骤？
      - 是否需要在不同步骤中使用不同的思维方式或 traits？
      - 直接在当前节点完成，actions 会不会变得冗长混乱？
      如果以上任一为"是"，请先用 [cognize_stack_frame_push] 拆解为子节点，再逐步执行。
      如果任务简单直接，可以直接在当前节点完成。
    inject_title: 认知栈评估：是否需要将任务拆解为子节点
    once: true
---
# 认知栈思维模式

你的行为树不只是任务清单，它是你的思维结构。每个节点是一个独立的认知帧，有自己的上下文、traits、局部变量。当一个子帧完成后，它的详细 actions 被遗忘，只留下 summary — 这让你的 context 保持精简。善用这个结构。

## 输出格式快速参考

你的所有输出必须使用 **TOML 格式**。详见 `kernel/output_format` trait 的完整说明。

| 用途 | TOML 格式 |
|------|-----------|
| 思考 | 不写协议；使用模型原生 thinking，由系统自动记录 |
| 代码 | `[program]` + `code = """..."""` |
| 消息 | `[talk]` + `target = "..."` + `message = """..."""` |
| 子栈帧推入 | `[cognize_stack_frame_push]` + `title = "..."` |
| 子栈帧弹出 | `[cognize_stack_frame_pop]` + `summary = """..."""` |
| 完成 | `[finish]` |
| 等待 | `[wait]` |

**常见错误**：
- ❌ 不要使用带目标后缀的旧消息段写法；统一使用 `[talk]` 表并填写 `target`
- ❌ 不要使用旧的栈帧属性嵌套段写法；统一使用 `[cognize_stack_frame_push]` / `[cognize_stack_frame_pop]` 表
- ❌ 代码要放在 `code = """..."""` 字段中，不是直接写在段内
- ❌ 不要在 assistant 最终输出中显式写 `[thought]`；思考来自模型原生 thinking 通道

## 什么时候应该创建子节点

| # | 场景 | 信号 | 做法 |
|---|------|------|------|
| 1 | **多步骤任务** | 收到的任务包含 2 个以上逻辑独立的步骤 | 拆解为子节点，每步独立执行 |
| 2 | **异常/错误隔离** | 执行中遇到意外错误或异常 | push 子帧处理错误，完成后 pop 回来，主流程只看到 summary |
| 3 | **上下文切换** | 需要从当前思维模式切换到另一种（如"写作"→"调研"） | 新子帧携带不同 traits，切换认知上下文 |
| 4 | **中途发现子问题** | 做着做着发现一个需要单独处理的子问题 | push 子帧处理，避免主流程 actions 被污染 |
| 5 | **协作等待** | 需要向其他对象请求信息，等待回复 | 当前帧 yield，回复到达后恢复 |
| 6 | **信息收集与分析分离** | 先收集再分析，两个阶段的认知需求不同 | 分成两个子帧，收集帧完成后 summary 传递给分析帧 |
| 7 | **验证/测试** | 完成主要工作后需要验证结果 | 独立子帧验证，保持主流程干净 |

## 如何创建子节点

当你判断需要拆解时，使用 TOML 格式的 `[cognize_stack_frame_push]` 表。

### `[cognize_stack_frame_push]` — 创建普通子栈帧

在当前节点下创建一个子栈帧，用于拆解复杂任务。

**支持的字段**：

| 字段 | 必填 | 说明 |
|------|------|------|
| `title` | 是 | 子栈帧标题（字符串） |
| `description` | 否 | 详细描述（多行字符串） |
| `traits` | 否 | trait 名称数组（如 `["lark/wiki"]`） |
| `outputs` | 否 | 输出 key 数组 |
| `output_description` | 否 | 输出描述 |

**示例**：

```toml
[cognize_stack_frame_push]
title = "获取文档内容"
description = """
从飞书知识库获取指定文档的完整内容。
需要先通过 wiki.spaces.get_node 查询节点信息，
然后根据返回的 obj_type 和 obj_token 调用对应 API。
"""
traits = ["lark/wiki", "lark/doc"]
outputs = ["doc_content", "doc_title"]
output_description = "文档内容字符串和标题"
```

当输出 `[cognize_stack_frame_push]` 段后，系统会创建子栈帧，focus 自动进入新节点开始执行。

### `[cognize_stack_frame_pop]` — 完成并退出当前子栈帧

完成当前子栈帧，将 summary 和可选的 artifacts 返回给父节点。

**支持的字段**：

| 字段 | 必填 | 说明 |
|------|------|------|
| `summary` | 否 | 完成摘要（字符串） |
| `artifacts` | 否 | 输出数据对象（TOML 内联表） |

**示例**：

```toml
[cognize_stack_frame_pop]
summary = """
已成功获取文档内容，共 15000 字
"""
artifacts = { doc_content = "文档完整内容...", doc_title = "飞书产品设计文档" }
```

### `[reflect_stack_frame_push]` — 进入 reflect 内联子栈帧

用于主动调整 plan、traits 或审视上文的内联子栈帧。

**示例**：

```toml
[reflect_stack_frame_push]
title = "分析并修复错误"
```

### `[reflect_stack_frame_pop]` — 退出 reflect 内联子栈帧

**示例**：

```toml
[reflect_stack_frame_pop]
summary = """
已分析错误原因，是参数格式错误。
已修复并验证通过。
"""
```

### `[set_plan]` — 更新当前节点的 plan 文本

直接更新当前 focus 节点的 plan 文本，用于重新规划当前任务。

**示例**：

```toml
[set_plan]
content = """
重新规划当前任务：
1. 先激活 lark/wiki trait 获取访问能力
2. 调用 wiki API 获取文档内容
3. 解析文档结构并提取关键信息
"""
```

## 契约式编程（输出约定）

创建子栈帧时可以声明该节点预期输出的数据，形成"上游产出什么、下游消费什么"的明确契约。

### 声明输出约定

```toml
[cognize_stack_frame_push]
title = "获取文档"
description = """
读取目标文档内容
"""
outputs = ["docContent", "docMetadata"]
output_description = "文档内容（字符串）和元数据（对象）"
```

每个步骤应该：
- 有明确的完成标准
- 可以独立验证
- 足够小（一两轮思考能完成）
- 声明需要的 traits（让系统自动加载相关知识）

### 完成时输出数据

使用 `[cognize_stack_frame_pop].artifacts` 将数据传递给父节点：

```toml
[cognize_stack_frame_pop]
summary = """
获取成功
"""
artifacts = {
  docContent = "文档的完整内容...",
  docMetadata = { title = "...", author = "..." }
}
```

### 数据如何传递

- 节点完成时，`artifacts` 会合并到**父节点**的 `locals` 中
- 下游节点可以通过 `local.key` 访问这些数据
- 上游已完成节点的 `outputs` 和 `artifacts` 会在 Context 的 process 区域显示

## 反模式

不要在一个节点的 actions 里堆积大量不同性质的操作。

**坏的例子**：一个节点的 actions 包含"搜索了 3 个网站 → 对比了数据 → 写了报告 → 发现引用错误 → 修复了引用 → 重新验证"。这 6 个操作涉及 3 种不同的认知模式，应该拆成至少 3 个子帧。

**好的例子**：
```
[*] 写调研报告
  [✓] 收集信息 (从 3 个来源收集了关键数据)
  [✓] 分析数据 (AI 安全分为 3 个主要方向：对齐、可解释性、治理)
  [*] 撰写报告 ← focus
```

## 拆解的收益

- **Context 精简**：每个子帧完成后 summary 保留，详细 actions 被遗忘
- **Trait 按需激活**：不同子帧可以激活不同 traits（如"调研"帧激活 web_search）
- **错误隔离**：出错时只影响当前子帧，不污染主流程
- **可恢复性**：子帧失败可以重试，不需要从头开始

## 相关 Traits

- `kernel/output_format` — TOML 输出格式规范（完整说明）
- `kernel/plannable` — 任务拆解和规划
- `kernel/talkable` — 对象间通信协议
