---
when: 当任务包含多个步骤、需要拆解、或不确定从哪里开始时
description: "任务拆解和行为树规划，先想清楚再动手"
deps: []
---

# 规划能力

## 段落标记式规划 API

使用段落标记格式来创建和管理子栈帧，替代旧的函数调用式 API。

### `[cognize_stack_frame_push]` — 创建普通子栈帧

在当前节点下创建一个子栈帧，用于拆解复杂任务。

**支持的属性段落**：

| 属性段落 | 必填 | 说明 |
|-----------|------|------|
| `[cognize_stack_frame_push.title]` | 是 | 子栈帧标题 |
| `[cognize_stack_frame_push.description]` | 否 | 详细描述 |
| `[cognize_stack_frame_push.traits]` | 否 | trait 名称列表，逗号分隔 |
| `[cognize_stack_frame_push.outputs]` | 否 | 输出 key 列表，逗号分隔 |
| `[cognize_stack_frame_push.outputDescription]` | 否 | 输出描述 |

**示例**：

创建一个简单的子栈帧：
```
[cognize_stack_frame_push.title]
收集信息
[/cognize_stack_frame_push.title]

[cognize_stack_frame_push.description]
从 3 个来源收集数据
[/cognize_stack_frame_push.description]

[cognize_stack_frame_push.traits]
web_search
[/cognize_stack_frame_push.traits]

[/cognize_stack_frame_push]
```

当输出 `[/cognize_stack_frame_push]` 结束标记后，系统会创建子栈帧，focus 自动进入新节点开始执行。

### `[cognize_stack_frame_pop]` — 完成并退出当前子栈帧

完成当前子栈帧，将 summary 和可选的 artifacts 返回给父节点。

**支持的属性段落**：

| 属性段落 | 必填 | 说明 |
|-----------|------|------|
| `[cognize_stack_frame_pop.summary]` | 否 | 完成摘要 |
| `[cognize_stack_frame_pop.artifacts]` | 否 | JSON 格式的输出数据 |

**示例**：

```
[cognize_stack_frame_pop.summary]
从 3 个来源收集了关键数据
[/cognize_stack_frame_pop.summary]

[/cognize_stack_frame_pop]
```

### `[reflect_stack_frame_push]` — 进入 reflect 内联子栈帧

用于主动调整 plan、traits 或审视上文的内联子栈帧。格式与 `[cognize_stack_frame_push]` 相同。

在 reflect 环节可以使用 `create_hook` 注册 `when_error` hook：

```
[reflect_stack_frame_push.title]
分析并修复错误
[/reflect_stack_frame_push.title]

[program]
create_hook("when_error", "inject_message", "分析错误原因并尝试修复");
[/program]

[/reflect_stack_frame_push]
```

### `[reflect_stack_frame_pop]` — 退出 reflect 内联子栈帧

格式与 `[cognize_stack_frame_pop]` 相同。

### `[set_plan]` — 更新当前节点的 plan 文本

直接更新当前 focus 节点的 plan 文本，用于重新规划当前任务。

**示例**：

```
[set_plan]
重新规划当前任务：
1. 先激活 lark-wiki trait 获取访问能力
2. 调用 wiki API 获取文档内容
3. 解析文档结构并提取关键信息
[/set_plan]
```

## 契约式编程（输出约定）

创建子栈帧时可以声明该节点预期输出的数据，形成"上游产出什么、下游消费什么"的明确契约。

### 声明输出约定

```
[cognize_stack_frame_push.title]
获取文档
[/cognize_stack_frame_push.title]

[cognize_stack_frame_push.description]
读取目标文档内容
[/cognize_stack_frame_push.description]

[cognize_stack_frame_push.outputs]
docContent, docMetadata
[/cognize_stack_frame_push.outputs]

[cognize_stack_frame_push.outputDescription]
文档内容（字符串）和元数据（对象）
[/cognize_stack_frame_push.outputDescription]

[/cognize_stack_frame_push]
```

每个步骤应该：
- 有明确的完成标准
- 可以独立验证
- 足够小（一两轮思考能完成）
- 声明需要的 traits（让系统自动加载相关知识）

### 完成时输出数据

使用 `[cognize_stack_frame_pop.artifacts]` 将数据传递给父节点：

```
[cognize_stack_frame_pop.summary]
获取成功
[/cognize_stack_frame_pop.summary]

[cognize_stack_frame_pop.artifacts]
{
  "docContent": "文档的完整内容...",
  "docMetadata": { "title": "...", "author": "..." }
}
[/cognize_stack_frame_pop.artifacts]

[/cognize_stack_frame_pop]
```

### 数据如何传递

- 节点完成时，`artifacts` 会合并到**父节点**的 `locals` 中
- 下游节点可以通过 `local.key` 访问这些数据
- 上游已完成节点的 `outputs` 和 `artifacts` 会在 Context 的 process 区域显示

### 示例：完整的数据流

步骤 1：创建获取配置的子栈帧

```
[cognize_stack_frame_push.title]
读取配置
[/cognize_stack_frame_push.title]

[cognize_stack_frame_push.outputs]
config
[/cognize_stack_frame_push.outputs]

[cognize_stack_frame_push.outputDescription]
项目配置对象
[/cognize_stack_frame_push.outputDescription]

[/cognize_stack_frame_push]
```

步骤 1 完成后输出：

```
[cognize_stack_frame_pop.summary]
配置读取成功
[/cognize_stack_frame_pop.summary]

[cognize_stack_frame_pop.artifacts]
{
  "config": { "path": "/tmp/data", "format": "json" }
}
[/cognize_stack_frame_pop.artifacts]

[/cognize_stack_frame_pop]
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

```
[thought]
这是一个复杂任务，我需要分步骤完成。

[cognize_stack_frame_push.title]
收集信息
[/cognize_stack_frame_push.title]

[cognize_stack_frame_push.description]
从 3 个主要来源收集论文
[/cognize_stack_frame_push.description]

[cognize_stack_frame_push.traits]
web_search
[/cognize_stack_frame_push.traits]

[/cognize_stack_frame_push]
```

子栈帧创建后，focus 自动进入该节点开始执行。

完成后：
```
[cognize_stack_frame_pop.summary]
收集了 5 篇论文的关键数据
[/cognize_stack_frame_pop.summary]

[/cognize_stack_frame_pop]
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
