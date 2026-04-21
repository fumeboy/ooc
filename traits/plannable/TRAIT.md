---
namespace: kernel
name: plannable
type: how_to_think
version: 2.0.0
when: never
command_binding:
  commands: ["create_sub_thread", "continue_sub_thread", "set_plan"]
description: 任务拆解与规划 — 先想清楚再动手
deps: []
---

# 规划能力

## 核心原则

1. **先拆解再执行** — 复杂任务先用 set_plan 写出计划，再逐步执行
2. **一次只做一步** — 每步完成后验证，再进入下一步
3. **子线程处理子任务** — 用 create_sub_thread 将独立子任务委托给子线程

## 子线程

通过 `open(type=command, command=create_sub_thread)` → `submit(title, description, traits)` 创建子线程。

子线程特点：
- 继承父线程的 trait 作用域
- 独立执行，有自己的 actions 历史
- 完成后 return summary 给父线程
- 父线程通过 `await` 等待子线程完成

适合拆分为子线程的场景：
- 独立的子任务（互不依赖）
- 需要不同 trait 的工作
- 可以并行执行的步骤

## set_plan

通过 `open(type=command, command=set_plan)` → `submit(text="...")` 更新当前线程的计划。

计划会展示在 Context 中，帮助你保持方向感。建议在以下时机更新计划：
- 任务开始时：写出初始计划
- 发现新信息时：调整计划
- 完成一个阶段时：标记进度

## continue_sub_thread

通过 `open(type=command, command=continue_sub_thread)` → `submit(thread_id, message)` 向已创建的子线程追加消息。

用于：
- 补充信息给正在执行的子线程
- 修正子线程的方向

## 契约式编程

创建子线程时，在 description 中明确声明：
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
