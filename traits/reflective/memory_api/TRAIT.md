---
namespace: kernel
name: reflective/memory_api
type: how_to_use_tool
description: 记忆 API 详细文档 — Flow Summary、长期记忆、会话记忆、维护原则
deps: ["kernel:reflective"]
---

# 记忆 API 详细文档

## Self 与 Session

你有两层存储空间：

- **Self**（自我）：跨任务持久存在的身份、记忆、能力。你不能直接写 Self，必须通过 `talk` command 与你的反思镜像分身 `super` 对话。
- **Session**（此刻）：当前任务的工作空间，任务结束即消散。你可以自由读写 Session。

## 跨对话摘要（Flow Summary）

每次对话结束前，用 `updateFlowSummary` 写一句话摘要。下次新对话时，系统会自动加载最近几次对话的摘要到你的上下文中。

```text
讨论了 API 设计方案，决定采用 REST + WebSocket 混合架构。
```

## 长期记忆（Self Memory）

存储在 Self 的 `memory.md`，跨任务持久存在。你可以用 `getMemory()` 读取，但不能直接写入。
想更新长期记忆，向你自己的反思分身（super）说话：

```javascript
// 检索长期记忆（只读）
const mem = await callMethod("reflective/memory_api", "query_memory", { query: "用户偏好", limit: 5 });
```

写入长期记忆仍通过 `super` 请求：

```json
open({"title":"沉淀用户偏好","type":"command","command":"talk","description":"请求 super 记录长期偏好"})
refine({"form_id":"<form id>","args":{"target":"super","msg":"请记住：用户偏好简洁的 markdown 格式回复","context":"fork"}})
submit({"form_id":"<form id>"})
```

## 会话记忆（Session Memory）

存储在当前 Session 的 `memory.md`，仅当前任务可见。你可以自由读写：

```text
## 当前进展
- 已完成数据收集
- 待分析
```

## 记忆维护原则

1. **memory 是索引，不是全文** — 简洁，像目录一样指引方向
2. **重要性过滤** — 不是所有信息都值得记住，只记录会影响未来决策的内容
3. **通过 SuperFlow 沉淀** — 你的 super 镜像分身会帮你合并、去重、整理长期记忆

## 结构化记忆检索（Memory Curation 2026-04-22）

长期记忆除了 `memory.md`（append-only snapshot），还有结构化版本 `memory/entries/{id}.json`。
你可以通过 `program` 沙箱里的 `callMethod("reflective/memory_api", method, args)` 检索；单个方法也可以通过 `open({ type: "command", command: "program", title, trait: "reflective/memory_api", method })` 发起。

```javascript
// 关键词检索（模糊匹配 key/content/tags/category）
const r = await callMethod("reflective/memory_api", "query_memory", { query: "调试 API", limit: 10 });
// r.data.entries = [{ id, key, contentPreview, tags, category, createdAt, pinned }, ...]

// 按 tag 过滤
const r = await callMethod("reflective/memory_api", "query_memory", { tags: ["debugging"] });

// 只看最近一周
const r = await callMethod("reflective/memory_api", "query_memory", { since: "2026-04-15T00:00:00Z" });

// 只看固化条目
const r = await callMethod("reflective/memory_api", "query_memory", { onlyPinned: true });

// 拿到 id 后获取详情
const full = await callMethod("reflective/memory_api", "get_memory_entry", { id: "me_20260422_abcd1234" });
// full.data = { id, key, content, tags, category, createdAt, updatedAt, pinned, ttlDays, source }
```

## 写入通道仍然是 super

本 trait 只提供 **读** 能力。写入/维护/合并/pin/TTL 的操作都在 `kernel/reflective/super`：
- `persist_to_memory` — 沉淀新条目（同时写 memory.md + entries/*.json）
- `migrate_memory_md` — 把老 memory.md 迁移为结构化 entries（幂等）
- `merge_memory_duplicates` — 合并同 key 的重复条目
- `pin_memory` / `set_memory_ttl` — 固化与过期控制

## Memory vs Trait vs Data

| | Memory | Trait | Data |
|---|--------|-------|------|
| 本质 | 经验索引（"我记得什么"） | 行为定义（"我是什么"） | 结构化状态（"我有什么"） |
| 格式 | 自由 markdown 文本 | readme.md + 可选 index.ts | key-value JSON |
| 影响 | 作为上下文参考 | 改变行为模式 | 存储具体数据值 |
| 沉淀方式 | `talk("super", "请记住：...")` | `talk("super", "请沉淀为 trait：...")` | `talk("super", "请保存：...")` |
