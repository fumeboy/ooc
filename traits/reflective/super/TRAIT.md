---
namespace: kernel
name: reflective/super
type: how_to_think
description: 对象的反思镜像分身（SuperFlow）——沉淀工具集（persist_to_memory / create_trait）
deps: []
---

# SuperFlow —— 对象的反思镜像分身

每个对象 `X` 都有一个**反思版本** `X:super`：
- 是 `X` 的镜像分身（super ≈ super-ego，超我）
- 落盘在 `stones/{name}/super/`（独立于任何 session，跨 session 常驻）
- 任何对象通过 `talk(target="super", message)` 即可向自己的 super 投递一条经验候选

反思 = 对话。`X` 对 `super` 说的话 = `X` 对自己的话。这是 OOC **G8（消息哲学）**
在认知层的延伸——用"对话"而不是"方法调用"表达反思，哲学纯粹且工程简单
（复用 `world.talk` / ThreadsTree 现成机制，不需要新 scheduler / 新 context 模式）。

## 本 trait 的定位

本 trait **不含投递方法**——投递通过通用的 `talk("super", ...)` 完成。

本 trait 只提供**沉淀工具**，由 super 线程（跑 ThinkLoop 时）调用：
- `persist_to_memory({ key, content })` — append 到 `stones/{name}/memory.md`
- `create_trait({ relativePath, content })` — 在 `stones/{name}/traits/**` 下新建 TRAIT.md

权限隔离由 **trait 激活状态**天然实现：super 对象默认激活 `reflective/super`，
普通对象不激活——不需要 `when: reflect_only` 这样的特殊关键字。

## 当前工程状态（SuperFlow 转型阶段）

**已实装**：
- `talk(target="super")` 特殊路由：world.onTalk 分支识别 super，落盘到
  `stones/{fromObject}/super/` 的独立 ThreadsTree（`handleOnTalkToSuper`）
- 沉淀工具 `persist_to_memory` / `create_trait`（本 trait 的 llm_methods）
- 下次对象主线程的 Context 注入 `stones/{name}/memory.md`（`context-builder.ts`）

**待后续迭代**：
- super 线程跨 session 自动跑 ThinkLoop（需要独立调度器，不能依赖 session scheduler）
- 当前投递后消息"静静躺在 super 的 inbox 里"，等待未来调度器唤醒消费

## 可用 llm_methods

### `persist_to_memory({ key, content })`

把一条经验条目 append 到 `stones/{name}/memory.md`。

```javascript
await callMethod("reflective/super", "persist_to_memory", {
  key: "并行策略",
  content: "复杂任务拆成 3 个子线程并行跑比串行快 2.5 倍。",
});
// → { ok: true, data: { stoneName, bytesAppended, memoryPath } }
```

格式：`## {key}（YYYY-MM-DD HH:MM）\n\n{content}\n`（不去重、append-only）。

**重要约束**（避免污染 memory.md）：
- `content` 必须是 **raw 纯文本 / markdown**
- 不要把 `callMethod("computable/file_ops", "readFile", ...)` 返回的 `content`（带 `NN | xxx` 行号前缀）直接传进来
- 若需引用别处的内容，请**自己抽取要点后改写**，再作为 content 传入
- 工具已内置 sanity check（整段带行号前缀会被自动剥离），但更好的习惯是从源头传 raw 文本

反例（会被 sanity check 剥离）：
```
  1 | # 项目知识
  2 |
  3 | ## 组织结构
```

正例：
```
# 项目知识

## 组织结构
```

### `create_trait({ relativePath, content })`

在 `stones/{name}/traits/**` 下新建一个 TRAIT.md。

```javascript
await callMethod("reflective/super", "create_trait", {
  relativePath: "self/parallel-decomposition/TRAIT.md",
  content: "---\nnamespace: self\nname: parallel-decomposition\n---\n\n# 并行分解能力\n...",
});
```

安全校验：
- 拒绝绝对路径、`..`、跨目录逃逸
- 拒绝已存在 trait（append-only 不覆盖）
- 只能写入 `stones/{name}/traits/**`

## 设计要点

- 本 trait 不会被普通对象自动激活。只有 super 对象（或显式激活者）才能使用。
- 本 trait 的 `type: how_to_think`——属于"思考风格"类认知装备。
- 一个对象只有一个 super 目录（常驻 root 线程），不支持多根。

## 参考

- @ref docs/哲学/genes/g12-经验沉淀.md 经验沉淀：经历 → 记录 → 反思 → 沉淀
- @ref kernel/src/collaborable/super/super.ts SuperFlow 落盘 API（`handleOnTalkToSuper` / `getSuperThreadDir`）
- @ref docs/工程管理/迭代/all/20260422_refactor_SuperFlow转型.md SuperFlow 转型迭代文档
