---
namespace: kernel
name: plannable
type: how_to_think
version: 2.1.0
activates_on:
  show_content_when: ["do", "plan"]
description: 任务拆解与规划 — 先想清楚再动手
deps: []
---

# 规划能力

## 核心原则

1. **先拆解再执行** — 复杂任务先用 plan 写出计划，再逐步执行
2. **一次只做一步** — 每步完成后验证，再进入下一步
3. **用 do 派生子线程** — 把独立子任务委托给子线程，保持当前线程的视野单纯

## do —— 对自己的线程操作

`do` 统一了 fork（派生新子线程）和 continue（向已有线程补充信息）两种意图。
参数约定：

```
do {
  msg: string,                       # 要投递的消息
  threadId?: string,                 # 目标线程 ID
  context: "fork" | "continue",      # 操作模式
  traits?: string[],                 # fork 时，新子线程的 trait 列表
}
```

### 模式对照表

| 模式 | 含义 | threadId 处理 |
|------|------|--------------|
| `do(msg, context="fork")` | 在当前线程下派生新子线程 | 省略即以当前线程为父 |
| `do(msg, threadId=Y, context="fork")` | 在指定线程 Y 下派生子线程 | 必填 Y（必须存在） |
| `do(msg, threadId=Y, context="continue")` | 向线程 Y 投递消息、唤醒它 | 必填 Y |
| `do(msg, context="continue")` | **非法**（engine 会报错） | — |

### 语义要点

- **fork**：派生新线程，对原线程而言是 **readonly**——你在原线程什么都没改，只是"另开一枝"干点事情。适合：查资料、拆解子任务、探索方案、写临时笔记。需要等待子线程完成时，使用 `do(wait=true, context="fork")`。
- **continue**：向原线程 inbox 投递消息、唤醒它。这会**影响**原线程的后续思考。适合：补充信息、修正方向、追加指令、汇报结果。

### 使用方式

```
# 派生子线程去分析（fork）
open(title="分析模块 X", type=command, command=do, description="分析模块 X")
refine(title="填写分析任务", form_id="<...>", args={context="fork", msg="请分析 kernel/src/thinkable/engine/engine.ts 的 onTalk 路径", traits=["kernel/computable"]})
submit(title="分析模块 X", form_id="<...>")

# 向之前派生的线程补充信息（continue）
open(title="补充文件清单", type=command, command=do, description="给分析任务补充文件清单")
refine(title="填写补充信息", form_id="<...>", args={context="continue", threadId="th_xxx", msg="顺便看一下 tree.ts 的 createSubThread API"})
submit(title="补充文件清单", form_id="<...>")
```

子线程特点：
- 继承父线程的 trait 作用域
- 独立执行，有自己的 events 历史
- 完成后 return summary 给父线程
- 父线程通过 `do(wait=true)` 等待子线程完成

适合拆分为子线程的场景：
- 独立的子任务（互不依赖）
- 需要不同 trait 的工作
- 可以并行执行的步骤

## plan

通过 `open(title="更新计划", type=command, command=plan)` → `refine(args={text:"..."})` → `submit(form_id)` 更新当前线程的计划。

计划会展示在 Context 中，帮助你保持方向感。建议在以下时机更新计划：
- 任务开始时：写出初始计划
- 发现新信息时：调整计划
- 完成一个阶段时：标记进度

## 契约式编程

创建子线程时，在 msg 中明确声明：
- 这个子线程要做什么
- 预期产出什么结果
- 完成标准是什么

子线程 return 时，summary 应该包含约定的产出。

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

## 子 trait

| 子 trait | 内容 |
|----------|------|
| `kernel/plannable/kanban` | Session 级 Issue/Task 管理 API |
