---
namespace: kernel
name: reflective
type: how_to_think
version: 1.0.0
when: never
command_binding:
  commands: ["talk.this_thread_creator"]
description: 经验结晶与自我反思（SuperFlow），向自己的反思镜像分身对话来沉淀经验
deps: []
---

# 反思与经验沉淀能力（SuperFlow）

## 🧭 交付前后的反思门禁（必读）

**在向 `this_thread_creator` 交付结果前后，花一轮思考回顾：**

1. 这个任务中你学到了什么新东西？
2. 有什么值得长期记住的？向你自己的反思分身（super）投递一条经验：
   - 重要的事实或经验 → `await talk("super", "请记住：...")`
   - 可复用的行为模式 → `await talk("super", "请沉淀为 trait：...")`
3. 需要更新会话记忆（`updateSessionMemory`）吗？
4. 请用 `updateFlowSummary` 写一句话摘要，概括这次对话的主题和关键结论。
5. 有没有犯错？根因是什么？

确认后再交付；交付不会自动结束当前线程，仍可继续做必要的经验沉淀。

---

## 核心原则

**做完一件事后，花一轮思考回顾：学到了什么？有什么可以复用的？**

经验不沉淀就会丢失。下次遇到类似问题时，你会从零开始。

## 沉淀通道：talk(target="super")

"super" 是一个**特殊 talk target**——它指向你自己的**反思镜像分身**（super ≈ super-ego）。
A 对 super 说的话 = A 对自己的话。不是对 supervisor 说话。

```javascript
// 沉淀一条经验到自己的 super inbox（异步通道，不等回复）
await talk("super", "请记住：TypeScript 的 satisfies 关键字比 as 更安全");
await talk("super", "请沉淀为 trait：research_method — 1. 明确问题 2. 列出来源 3. 逐一收集 4. 交叉验证 5. 整理结论");
```

落盘位置：`stones/{你自己}/super/threads.json + threads/{rootId}/thread.json`。
super 的 ThinkLoop 消费 inbox 后，会调 `persist_to_memory` 写入 memory.md，
或调 `create_trait` 创建新的 trait。下次你启动时，Context 会自动注入 memory.md 里的经验。

## 什么不需要沉淀

- 一次性的、不会再遇到的问题
- 已经在现有 trait 或记忆中覆盖的知识
- 过于具体的、无法泛化的经验
- 大段的原始数据（记忆是索引，不是仓库）

## 相关子 trait

| 子 trait | 内容 |
|----------|------|
| `kernel/reflective/memory_api` | 记忆 API — Flow Summary、Self/Session、维护原则 |
| `kernel/reflective/super` | 反思镜像分身的沉淀工具集（persist_to_memory / create_trait） |
