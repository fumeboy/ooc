---
name: kernel/plannable
type: how_to_think
version: 1.0.0
when: 当任务包含多个步骤、需要拆解、或不确定从哪里开始时
description: 任务拆解和行为树规划，先想清楚再动手
deps: ["kernel/computable"]
---
# 规划能力

## 输出格式快速参考

你的所有输出必须使用 **TOML 格式**。详见 `kernel/computable/output_format` trait 的完整说明。

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

## 段落标记式规划 API

使用 TOML 格式来创建和管理子栈帧。

### `[cognize_stack_frame_push]` — 创建普通子栈帧

在当前节点下创建一个子栈帧，用于拆解复杂任务。

**支持的字段**：

| 字段 | 必填 | 说明 |
|------|------|------|
| `title` | 是 | 子栈帧标题 |
| `description` | 否 | 详细描述 |
| `traits` | 否 | trait 名称数组 |
| `outputs` | 否 | 输出 key 数组 |
| `output_description` | 否 | 输出描述 |

**示例**：

创建一个简单的子栈帧：

```toml
[cognize_stack_frame_push]
title = "收集信息"
description = """
从 3 个主要来源收集论文
"""
traits = ["web/search"]
```

当输出 `[cognize_stack_frame_push]` 段后，系统会创建子栈帧，focus 自动进入新节点开始执行。

### `[cognize_stack_frame_pop]` — 完成并退出当前子栈帧

完成当前子栈帧，将 summary 和可选的 artifacts 返回给父节点。

**示例**：

```toml
[cognize_stack_frame_pop]
summary = """
从 3 个来源收集了关键数据
"""
```

### `[reflect_stack_frame_push]` — 进入 reflect 内联子栈帧

用于主动调整 plan、traits 或审视上文的内联子栈帧。

在 reflect 环节可以使用 `create_hook` 注册 `when_error` hook：

```toml
[reflect_stack_frame_push]
title = "分析并修复错误"
```

### `[reflect_stack_frame_pop]` — 退出 reflect 内联子栈帧

格式与 `[cognize_stack_frame_pop]` 相同。

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

### 示例：完整的数据流

步骤 1：创建获取配置的子栈帧

```toml
[cognize_stack_frame_push]
title = "读取配置"
outputs = ["config"]
output_description = "项目配置对象"
```

步骤 1 完成后输出：

```toml
[cognize_stack_frame_pop]
summary = """
配置读取成功
"""
artifacts = { config = { path = "/tmp/data", format = "json" } }
```

步骤 2 开始后，可以通过 `local.config` 访问：
- `local.config.path === "/tmp/data"`
- `local.config.format === "json"`

## 按步骤执行

- 一次只做一步
- 每步完成后用 `[cognize_stack_frame_pop]` 标记，focus 自动推进到下一步
- 验证当前步骤的结果后再进入下一步
- 如果发现计划需要调整，用 `[cognize_stack_frame_push]` 创建新步骤

## 典型工作流

```toml
[cognize_stack_frame_push]
title = "收集信息"
description = """
从 3 个主要来源收集论文
"""
traits = ["web/search"]
```

子栈帧创建后，focus 自动进入该节点开始执行。

完成后：

```toml
[cognize_stack_frame_pop]
summary = """
收集了 5 篇论文的关键数据
"""
```

## YAGNI 原则

不做没被要求的事：
- 不添加"以防万一"的功能
- 不做"顺便优化"
- 不解决没被提到的问题
- 当前任务需要什么就做什么

## Red Flags

- "这个很简单，不需要计划" → 拆解后再判断
- "我先把所有东西都做了再说" → 一次只做一步
- "顺便把这个也改了" → 不在计划内的不做
- 做了 3 轮还没有明确进展 → 停下来重新规划

## 相关 Traits

- `kernel/computable/output_format` — TOML 输出格式规范（完整说明）
- `kernel/computable` — 认知栈思维模式（核心）
- `kernel/talkable` — 对象间通信协议
