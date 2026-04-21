---
namespace: kernel
name: reflective/memory_api
type: how_to_use_tool
when: never
description: 记忆 API 详细文档 — Flow Summary、长期记忆、会话记忆、维护原则
deps: ["kernel:reflective"]
---

# 记忆 API 详细文档

## Self 与 Session

你有两层存储空间：

- **Self**（自我）：跨任务持久存在的身份、记忆、能力。你不能直接写 Self，必须通过 `reflect` 与 ReflectFlow 对话。
- **Session**（此刻）：当前任务的工作空间，任务结束即消散。你可以自由读写 Session。

## 跨对话摘要（Flow Summary）

每次对话结束前，用 `updateFlowSummary` 写一句话摘要。下次新对话时，系统会自动加载最近几次对话的摘要到你的上下文中。

```javascript
updateFlowSummary("讨论了 API 设计方案，决定采用 REST + WebSocket 混合架构");
```

## 长期记忆（Self Memory）

存储在 Self 的 `memory.md`，跨任务持久存在。你可以用 `getMemory()` 读取，但不能直接写入。
想更新长期记忆，用 `reflect`：

```javascript
// 读取长期记忆（只读）
const mem = getMemory();
// 请求 ReflectFlow 更新长期记忆
reflect("请记住：用户偏好简洁的 markdown 格式回复");
```

## 会话记忆（Session Memory）

存储在当前 Session 的 `memory.md`，仅当前任务可见。你可以自由读写：

```javascript
const sessionMem = getSessionMemory();
updateSessionMemory("## 当前进展\n- 已完成数据收集\n- 待分析");
```

## 记忆维护原则

1. **memory 是索引，不是全文** — 简洁，像目录一样指引方向
2. **重要性过滤** — 不是所有信息都值得记住，只记录会影响未来决策的内容
3. **通过 ReflectFlow 沉淀** — ReflectFlow 会帮你合并、去重、整理长期记忆

## Memory vs Trait vs Data

| | Memory | Trait | Data |
|---|--------|-------|------|
| 本质 | 经验索引（"我记得什么"） | 行为定义（"我是什么"） | 结构化状态（"我有什么"） |
| 格式 | 自由 markdown 文本 | readme.md + 可选 index.ts | key-value JSON |
| 影响 | 作为上下文参考 | 改变行为模式 | 存储具体数据值 |
| 沉淀方式 | `reflect("请记住：...")` | `reflect("请沉淀为 trait：...")` | `reflect("请保存：...")` |
