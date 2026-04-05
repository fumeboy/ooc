---
namespace: kernel
name: computable/stack_api
type: how_to_think
when: never
description: 栈帧 API 详细说明 — push/pop/reflect、契约编程、摘要技巧、Hook 时机、反模式
deps: ["kernel/computable"]
---

# 栈帧 API 详细说明

## TOML 栈帧 API

### `[cognize_stack_frame_push]` — 创建普通子栈帧

在当前 focus 节点下创建一个新的子栈帧，用于拆解复杂任务。

**支持的字段**：

| 字段 | 必填 | 说明 |
|------|------|------|
| `title` | 是 | 子栈帧标题 |
| `description` | 否 | 详细描述 |
| `traits` | 否 | trait 名称数组 |
| `outputs` | 否 | 输出 key 数组 |
| `output_description` | 否 | 输出描述 |

**示例**：

    [cognize_stack_frame_push]
    title = "获取文档内容"
    description = """
    从飞书知识库获取指定文档的完整内容
    """
    traits = ["lark/wiki"]
    outputs = ["docContent", "docTitle"]
    output_description = "文档内容（字符串）和元数据（对象）"

### `[cognize_stack_frame_pop]` — 完成并退出当前子栈帧

完成当前子栈帧，将 summary 和可选的 artifacts 返回给父节点。

**支持的字段**：

| 字段 | 必填 | 说明 |
|------|------|------|
| `summary` | 否 | 完成摘要 |
| `artifacts` | 否 | TOML 对象格式的输出数据 |

**数据传递规则**：
- 节点完成时，`artifacts` 会合并到**父节点**的 `locals` 中
- 父节点可以通过 `local.key` 访问这些数据

### `[reflect_stack_frame_push]` — 进入 reflect 内联子栈帧

用于主动调整 plan、traits 或审视上文的内联子栈帧。

在 reflect 环节可以使用 `create_hook` 注册 `when_error` hook：

```toml
[reflect_stack_frame_push]
title = "分析并修复错误"

[program]
code = """
create_hook("when_error", "inject_message", "分析错误原因并尝试修复");
"""
```

### `[set_plan]` — 更新当前节点的 plan 文本

```toml
[set_plan]
content = """
重新规划当前任务：
1. 先激活 lark-wiki trait 获取访问能力
2. 调用 wiki API 获取文档内容
"""
```

## 什么时候应该创建子节点

| # | 场景 | 信号 | 做法 |
|---|------|------|------|
| 1 | **多步骤任务** | 收到的任务包含 2 个以上逻辑独立的步骤 | 拆解为子节点 |
| 2 | **异常/错误隔离** | 执行中遇到意外错误 | push 子帧处理，pop 后主流程只看 summary |
| 3 | **上下文切换** | 需要切换思维方式 | 新子帧携带不同 traits |
| 4 | **中途发现子问题** | 做着发现需要单独处理的问题 | push 子帧避免主流程污染 |
| 5 | **协作等待** | 需要向其他对象请求信息 | 当前帧 yield |
| 6 | **信息收集与分析分离** | 先收集再分析，认知需求不同 | 分成两个子帧 |
| 7 | **验证/测试** | 完成主要工作后需要验证 | 独立子帧验证 |

## 契约式编程（输出约定）

### 声明输出约定

```toml
[cognize_stack_frame_push]
title = "获取文档"
outputs = ["docContent", "docMetadata"]
output_description = "文档内容（字符串）和元数据（对象）"
```

每个步骤应该：
- 有明确的完成标准
- 可以独立验证
- 足够小（一两轮思考能完成）
- 声明需要的 traits

### 完成时输出数据

```toml
[cognize_stack_frame_pop]
summary = "获取成功"
artifacts = {
  docContent = "文档的完整内容...",
  docMetadata = { title = "...", author = "..." }
}
```

## 摘要技巧

好的摘要 = 结论 + 关键中间产物。

**反模式**：只有动作没有结论，太空洞下文不知道完成了什么。

**正确做法**：
- 结论要具体
- 有中间结果时用 artifacts 保留
- artifacts 的 key 要有语义
- 只保留下文可能需要的：搜索结果、计算输出、收到的回复、关键路径
- 不保留过程性信息：思考过程、尝试失败的方案

## 反模式

不要在一个节点的 actions 里堆积大量不同性质的操作。

**坏的例子**：一个节点的 actions 包含"搜索了 3 个网站 → 对比了数据 → 写了报告 → 发现引用错误 → 修复了引用 → 重新验证"。6 个操作涉及 3 种认知模式，应拆成至少 3 个子帧。

**好的例子**：
```
[*] 写调研报告
  [✓] 收集信息 (从 3 个来源收集了关键数据)
  [✓] 分析数据 (AI 安全分为 3 个主要方向)
  [*] 撰写报告 ← focus
```

## 拆解的收益

- **Context 精简**：每个子帧完成后 summary 保留，详细 actions 被遗忘
- **Trait 按需激活**：不同子帧可以激活不同 traits
- **错误隔离**：出错时只影响当前子帧
- **可恢复性**：子帧失败可以重试
