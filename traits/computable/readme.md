---
when: always
description: "认知栈思维模式 — 用行为树结构化你的思考过程"
deps: []
hooks:
  before:
    inject: |
      你刚进入一个新的任务节点。在开始执行之前，先评估：
      - 这个任务是否包含多个逻辑独立的步骤？
      - 是否需要在不同步骤中使用不同的思维方式或 traits？
      - 直接在当前节点完成，actions 会不会变得冗长混乱？
      如果以上任一为"是"，请先用 [cognize_stack_frame_push] 拆解为子节点，再逐步执行。
      如果任务简单直接，可以直接在当前节点完成。
    inject_title: "认知栈评估：是否需要将任务拆解为子节点"
    once: true
---

# 认知栈思维模式

你的行为树不只是任务清单，它是你的思维结构。每个节点是一个独立的认知帧，有自己的上下文、traits、局部变量。当一个子帧完成后，它的详细 actions 被遗忘，只留下 summary — 这让你的 context 保持精简。善用这个结构。

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

当你判断需要拆解时，使用段落标记式 API。

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

```
[cognize_stack_frame_push.title]
获取文档内容
[/cognize_stack_frame_push.title]

[cognize_stack_frame_push.description]
从飞书知识库获取指定文档的完整内容
[/cognize_stack_frame_push.description]

[cognize_stack_frame_push.traits]
lark-wiki
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
已成功获取文档内容，共 15000 字
[/cognize_stack_frame_pop.summary]

[cognize_stack_frame_pop.artifacts]
{
  "docContent": "文档完整内容...",
  "docTitle": "飞书产品设计文档"
}
[/cognize_stack_frame_pop.artifacts]

[/cognize_stack_frame_pop]
```

### `[reflect_stack_frame_push]` — 进入 reflect 内联子栈帧

用于主动调整 plan、traits 或审视上文的内联子栈帧。格式与 `[cognize_stack_frame_push]` 相同。

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

详细的 API 说明请参考 computable trait（核心程序执行能力）和 plannable trait（规划能力）文档。

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
