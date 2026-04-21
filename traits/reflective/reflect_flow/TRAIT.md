---
namespace: kernel
name: reflective/reflect_flow
type: how_to_think
when: never
description: 常驻反思线程（ReflectFlow 线程树版）— 经验沉淀循环的工程通道
deps: []
---

# ReflectFlow 线程树版

每个对象都有一条独立于任何 session 的**常驻反思线程**：
- 落盘在 `stones/{name}/reflect/threads.json + threads/{id}/thread.json`
- 结构与普通线程树一致（root 线程 + inbox + actions + todos + …）
- 生命周期横跨所有 session——对象每次新对话共享同一条反思线程

反思线程是 **G12（经验沉淀）** 的工程通道：
- **经历** → 任务执行时发生的有意义事件
- **记录** → 调用 `talkToSelf(message)` 把候选经验投递到反思线程 inbox
- **反思**（未来迭代实装）→ 跨 session 常驻调度器唤醒反思线程跑一轮 ThinkLoop
- **沉淀**（未来迭代实装）→ 反思线程决定是否把经验写入 memory.md / 创建 trait

## 当前状态（方案 A 最小可用）

**已实装**：
- 投递通道：`callMethod("reflective/reflect_flow", "talkToSelf", { message })` 从任何对象线程都能调用
- 落盘：`stones/{name}/reflect/` 目录自动初始化，消息写入 root 线程 inbox
- 状态查询：`callMethod("reflective/reflect_flow", "getReflectState", {})` 查看反思线程当前 inbox
- 幂等 + 并发安全：多次调用 `talkToSelf` 不会破坏线程树结构
- 线程复活：若反思线程当前 status=done，`talkToSelf` 投递会自动把它置回 running（等待未来调度器消费）

**暂不实装**（后续迭代 backlog）：
- 反思线程 ThinkLoop 实际执行——当前消息只是"静静躺在 inbox 里"
- 跨 session 常驻调度器（需要新的线程调度模型，参考 `ThreadScheduler` 但脱离 session 生命周期）
- 反思产出自动写入 memory.md 或创建 trait
- 下次主线程 Context 构建时自动注入 memory.md 让经验生效
- 反思专属权限（如访问 `self_traits_dir` 写 trait）

## 可用 llm_methods

### `talkToSelf({ message })`

把一段值得反思的经验投递到反思线程 inbox。

```javascript
await callMethod("reflective/reflect_flow", "talkToSelf", {
  message: "刚才把任务拆成 3 个子线程并行跑，效果比串行快 2.5 倍。下次复杂任务可先考虑并行。",
});
// → { ok: true, data: { stoneName: "bruce", messagePreview: "..." } }
```

**调用时机建议**：
- 当意识到"这个做法/教训对将来重要"时，立即投递
- 不要为了触发反思而编造内容——反思线程处理的是真实经验
- 不需要高频调用；每次任务 1-3 条高信息密度的记录即可

### `getReflectState({})`

查看反思线程当前 inbox 状态。

```javascript
const r = await callMethod("reflective/reflect_flow", "getReflectState", {});
// → { ok: true, data: { stoneName, initialized, inboxTotal, inboxUnread, recentContents: [...5 条预览] } }
```

用于 LLM 自检："我累计投递过多少条反思？最近的几条是什么？"

## 设计要点

- 本 trait 的 `when: never`——不会被自动激活到栈帧认知链。要使用其方法，对象通过 `callMethod` 主动调用即可。
- 投递的 inbox 消息 `source: "system"`——区别于 `talk` 来源消息，将来调度器可据此决定不同处理策略。
- 一个对象只有一个反思线程（常驻 root），不支持多根。若要把不同维度的反思分流，调度器实装后可在反思线程内部创建 sub_thread。

## 参考

- @ref docs/哲学文档/gene.md#G12 经验沉淀：经历 → 记录 → 反思 → 沉淀
- @ref kernel/src/thread/reflect.ts 落盘 API（`ensureReflectThread` / `talkToReflect` / `getReflectThreadDir`）
- @ref docs/工程管理/迭代/all/20260421_feature_ReflectFlow线程树化.md 本次迭代文档
