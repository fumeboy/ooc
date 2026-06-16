# thread 持久化统一到标准 object 模型（计划）

> 状态：**设计已定，待落地**。本篇记录把 thread 持久化收敛成 object-model 标准 `save/load` 的想法与计划，
> 并**退役**上一版引入的 `PersistableModule.container` / `ThreadContainerPersistence`（那一版方向错了，详见「为什么」）。
> 设计权威：`.ooc-world-meta/.../children/class/knowledge/object-model.md` 核心 4 / 7；
> persistable 边界 `.ooc-world-meta/.../children/persistable/knowledge/core-framework-vs-builtin-logic.md`（落地后须回流修正）。

## 决策

thread 是一个**普通 object**，它的持久化走 object-model 标准契约 `persistable.save(ctx, data)` / `load(ctx)`
（与 `builtins/example/persistable/index.ts` 同一套），**不需要**任何 thread 专属的 `container` 能力。

## 为什么（对齐 object-model，纠正上一版）

上一版（commit 4d7e79f4）把 thread 持久化逻辑从 core 下沉到 thread builtin，但用了一个新契约
`PersistableModule.container = {write, read, writeSnapshot}`。这是在为**实现的偶然性**套命名，不是对齐模型。三处纠正：

1. **没有「双重 data 形态」**。object-model 核心 4：object 持一份 data，readable 把 data **投影**成 window、
   按视角动态算 class，「投影态与 data 分离」。`thread/readable/index.ts` 的 `computeProjectionClass` 正是如此——
   thread / talk / reflect_request 三视角是 readable 的 **POV 投影、显式不持久化**。所以只有**一份 thread data**，
   "窗 vs 会话" 是渲染视角，不是持久化形态。上一版把渲染视角误当成两份 data，才以为塞不进 `save/load`。

2. **threadId 属于 Data**。thread 是 object，threadId 是它的身份，应在 `types.ts` 的 Data 里自描述；
   thread 按自己的实例 id 标准寻址，`load` 不需要外挂 threadId 参数。

3. **per-child `state.json` + `thread-context.json` + inline-vs-`_ref` 是 ooc-6「双写期」实现残渣，不是模型**。
   object-model 只讲 object↔data↔persistable。子窗 data 应合并进 thread Data 一起存，拆分作废。

## 统一模型（目标态）

```ts
// thread/types.ts —— Data = 整个会话运行态（一份 blob 自描述）
interface Data {
  threadId: string;
  status: ...; events: ...[]; inbox: ...[]; outbox: ...[];
  target?: string; conversationId?: string; isForkWindow?: boolean; isCreatorWindow?: boolean;
  // 子窗 data + win 内联，不再各自 state.json：
  contextWindows: { id: string; class: string; data: unknown; win?: unknown; ...envelope }[];
}

// thread/persistable/index.ts —— 标准 save/load，删 container
const persistable: PersistableModule<Data> = {
  save: (ctx, data) => writeBlob(ctx, data),
  load: (ctx) => readBlob(ctx),   // 内含 hydrate：initContextWindows / injectPeer / injectMember
};
```

- **readable 不动**（已在做投影）。
- **manager persist hook**（`reportDataEdit` / `reportContextEdit`）收敛成「save 本 thread 的 Data」一种操作。
- **core 退回纯框架**：通用 `save/load` dispatch（`object-data.ts` 的 custom-or-default）+ 路径原语 + 串行写；
  不再有 thread 专属机制。

## 待确认（落地前）

**窗变成 thread 独占**：子窗 data 内联进 thread Data ⇒ ooc-6 的「独立 object 跨线程 by-ref 共享 +
扁平 `objects/<id>` + `_ref`」机制作废。判断：实操里没真用上——跨线程共享的只有 filesystem/terminal 等单例，
而它们是 `win.transient`、不落盘、每次 init 重注入，不受影响。**结论：窗按 thread 独占、放弃跨线程对象共享**
（落地前若发现真实共享用例再议）。

## 落地增量（源码每步保绿、坏测试只登记不中途修）

1. **退役 container**：删 `thread/persistable/thread-container.ts`、`PersistableModule.container` /
   `ThreadContainerPersistence`（`core/persistable/contract.ts`）；thread/persistable 改回标准 `{save, load}`。
2. **Data 扩容**：`thread/types.ts` 的 Data 纳入 threadId + status/events/inbox/outbox + contextWindows（内联 data+win）。
3. **save/load 实现**：把原 thread-container 的 write/read/hydrate 逻辑重写成 `save(ctx,data)` / `load(ctx)`
   （hydrate 并入 load）；子窗 data 内联序列化，不再调 per-child `state.json`。
4. **core 退役容器机制**：`thread-json.ts`（writeThread/readThread 薄壳）、`flow-thread-context.ts`（thread-context.json
   读写 + ThreadContextEntry）、`window-persistence.ts`（容器快照 dispatch）、`flow-runtime-object.ts` 的 per-child
   `state.json` 路径——按依赖逐个退役或收敛为标准 object 持久化。
5. **调用点收敛**：`writeThread`/`readThread` 的 8 处调用（`thinkable/{scheduler,thinkloop}`、
   `app/server/runtime/{worker,resume,thread-query,resume-orchestration}`、`app/server/modules/{runtime,flows}/service`）
   收敛到标准 object save/load API。
6. **退潮 + 修测试**：删死文件、回流 `core-framework-vs-builtin-logic.md`（thread 不再是「container 特例」、
   改述为「thread 就是标准 object，save/load 整份会话 Data」）+ persistable/class self.md；统一修登记的坏测试、跑绿。

## 爆炸半径 / 退役清单

- 退役：`thread/persistable/thread-container.ts`、`PersistableModule.container`、`ThreadContainerPersistence`、
  `thread-context.json`、per-child `state.json`(thread 内窗)、inline-vs-`_ref`、`buildThreadContextEntries`、
  `WindowPersistence` 的容器快照。
- 收敛：`writeThread`/`readThread` → 标准 object 持久化；manager hook → save thread Data。
- 保留：`object-data.ts` 的 custom-or-default dispatch（框架）、路径原语、串行写、inbox per-message 原语（按需）。

## 验证

非测试源码 tsc 全程 0；thread save/load round-trip 运行时验证；storybook 控制面 PERS + 会话场景跑绿；
坏测试登记 `WAVE4-WALL-broken-tests.md`，全部源码改完后统一修。
