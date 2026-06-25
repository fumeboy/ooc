# thread 持久化统一到标准 object 模型（计划）

> 状态：**已落地（2026-06-16，增量 0-3 全完成）**。本篇把 thread 持久化收敛成 object-model 标准 `save/load`，
> **退役**了上一版引入的 `PersistableModule.container` / `ThreadContainerPersistence`（那层 indirection 方向错了，见「为什么」），
> 并把 `isCreatorWindow` 去状态化（id 派生 + close 投影可见性）。非测试源码 tsc 0；round-trip 验通；guard 全绿；
> doc 已回流对象树（push ooc-0）。剩 `conversationId`/`isForkWindow` 同属 id 镜像/寻址提示，本轮未动（见下）；
> 574 composition 测试基线非本重构责任，未碰。
> 设计权威：`.ooc-world-meta/.../children/object/self.md` 核心 4 / 7；
> persistable 边界 `.ooc-world-meta/.../children/persistable/knowledge/core-framework-vs-builtin-logic.md`（落地后须回流修正）。

## 决策

thread 是一个**普通 object**，持久化走 object-model 标准契约 `persistable.save(ctx, data)` / `load(ctx)`，
**不需要**任何 thread 专属的 `container` 能力。落地目标是**退掉 `container` 这层 indirection、理顺布局**——
**不是**把被持有对象的数据内联成一个胖 blob。

## 数据归属原则（落地的地基）

1. **context window = thread 对某对象的「视图」**：它只持**窗状态**（元信息 + `win` 视图态 + 指向哪个对象的
   **引用**），**不持被指对象的数据**。
2. **thread 的消息（inbox/outbox）/ events / status = thread 这个对象自身的数据**，落在 thread 对象层；
   它们只在**渲染时**被投影进各窗（`talk-render.ts` 的 `filterTalkMessages` 按 windowId/replyToWindowId 归位），
   **从不存在某条 window 里**。
3. 同一个 `_builtin/thread`，**两种角色、两种数据形态**：
   - **运行 thread**：对象数据（消息/events/status）+ 它持有的 contextWindows（窗状态）。
   - **作为别人 context 里的会话窗**：data = 指向那条 thread 的**引用**（`{target, targetThreadId(+session)}`）=
     窗状态。它的消息在被指那条 thread 那里，不在这个窗里。这就是 `thread/types.ts` 的 `Data`。
4. 因此「窗持引用、对象持数据」的 `_ref` 分层**本来就是对的**，保留：peer thread 的数据在 peer 自己的
   blob；filesystem/terminal/interpreter 等全局单例是 `win.transient` 引用（init 时 `injectMemberWindowsIfObjectThread`
   重注入、不落盘）；独立工具对象持自己的数据。thread 的 blob **不把被指对象的数据吸进来**。

## 为什么退 container（对齐 object-model，纠正上一版）

上一版（commit 4d7e79f4）把 thread 持久化逻辑从 core 下沉到 thread builtin，但用了一个新契约
`PersistableModule.container = {write, read, writeSnapshot}`。这是在为**实现的偶然性**套命名，不是对齐模型：

1. **没有「双重 data 形态」要发明新契约**。object-model 核心 4：object 持数据，readable 把它按 POV
   **投影**成 window、动态算 class（thread / talk / reflect_request），投影态不持久化。所以 thread 用标准
   `save/load` 即可，`container` 这层 indirection 是多余的。
2. **threadId 是 thread 的实例身份**。thread 按自己的实例 id 标准寻址（`{objectDir}/threads/{threadId}`），
   `save/load` 用 thread 作用域 ctx（`dir`=threadDir）即可，不需要 `container` 三件套。
3. **上一版误判**：把 `thread-context.json` / `_ref` 当「双写期残渣」要内联掉。按上面的归属原则，那套分层
   恰恰是对的（窗=引用、对象=数据）；要退的是 `container` indirection，不是分层。

## isCreatorWindow 去状态化

creator 窗的身份**已编码在 id 里**：`creatorWindowIdOf(threadId) = "w_creator_" + threadId`。`isCreatorWindow`
是 id 的冗余镜像，删字段，三处用途全部派生/吸收：

- **`close` 不可关 creator 窗**：靠**投影可见性**——self-view 投影（`thread` / `reflect_request`）的
  `object_methods` 不 surface `"close"`；`talk`（other-view，含父侧 fork 子窗）保留。取代 `close` 里
  `if (self.isCreatorWindow)` 的运行时检查。
- **投影 self/other 判别**（`computeProjectionClass`）：改 `id === creatorWindowIdOf(thread.id)`。
- **delivery 跨 session 路由**（`talk-delivery.ts` `isCreatorReply`）：按「转发到所指 thread（含它的
  session）」吸收；过渡期先 `callerWindow.id === creatorWindowIdOf(callerThread.id)` 派生，保持行为不变。

## 目标态

```ts
// thread/types.ts —— Data = 一条会话窗的状态（指向某 thread 的引用），删 isCreatorWindow
interface Data {
  target: string;            // 对端 objectId（peer）或自己 objectId（fork）
  targetThreadId?: string;   // 对端 thread id（peer 首条 say 回填 / fork 建窗即知）
  isForkWindow?: boolean;    // 同对象父子通道 vs 跨对象 peer（本轮保留；方向上可退化为寻址提示）
  conversationId: string;    // 同 target 多窗区分（当前 = windowId）
  // isCreatorWindow 删除 —— 由 id === creatorWindowIdOf(threadId) 派生
}

// thread 持久化 blob（≠ 上面的 Data）= thread 自身对象数据 + 它持有的窗状态
//   { ...thread 自身数据(status/events/outbox/...), contextWindows: 窗状态entry[] }
//   窗状态 entry = 元信息 + win + 引用（inline class 整窗 / 独立对象 _ref）；被指对象数据各自落。
//   inbox 走 per-message 目录（并发安全），渲染时投影进窗。

// thread/persistable/index.ts —— 标准 save/load，删 container
const persistable: PersistableModule = {
  save: (ctx, threadBlob) => writeThreadBlob(ctx, threadBlob),
  load: (ctx) => readThreadBlob(ctx),  // 内含 hydrate：initContextWindows / injectPeer / injectMember / merge inbox
};
```

- **readable 不动**（已在做投影）；`computeProjectionClass` 改 id 派生 self-view。
- **manager persist hook**：`reportContextEdit` → save 本 thread blob；`reportDataEdit` → 对象自身 save（不变）。
- **core 退回纯框架**：`writeThread`/`readThread` 仍是 thread 作用域 API，但 dispatch 到标准 `save/load`；
  不再有 `container` 三件套。

## 落地增量（源码每步保绿、坏测试只登记不中途修）

0. **改本 doc**（已完成）：目标态从「内联」改写成「窗持引用 / 对象持数据 / 消息属 thread 对象层」。
1. **isCreatorWindow 去状态化**：
   - `context-window.ts` 加 `isCreatorWindowId(id)`；`thread/types.ts` Data 删 `isCreatorWindow`；
     `init.ts` 不再写该字段。
   - `projection-class.ts` / `readable` self-view 判别改 id 派生；`readable/index.ts` 的 `thread`/`reflect_request`
     投影去掉 `"close"`。
   - ~40 处 `data.isCreatorWindow` 消费点（`talk-delivery.ts` / `wait.ts` / `context/{protocol,index}.ts` /
     `flows/service.ts` / `conversation-render.ts` / `method.end.ts` / `session-methods.ts` …）改 id 派生。
   - 坏测试登记 `WAVE4-WALL-broken-tests.md`，不中途修。
2. **退 container → 标准 save/load**：
   - `core/persistable/contract.ts` 删 `PersistableModule.container` / `ThreadContainerPersistence`。
   - `thread/persistable` 改标准 `{save, load}`：save 落「thread 自身数据 + 窗状态(含 `_ref`)」，对象数据各自落；
     load 内含 hydrate。
   - `thread-json.ts` `writeThread`/`readThread` dispatch 到 save/load（thread 作用域 ctx）。
   - `window-persistence.ts` manager hook 收敛到 save/对象 save。删 `thread-container.ts`。
3. **退潮 + 修测试**：删死代码；回流 `core-framework-vs-builtin-logic.md`（thread 不再是「container 特例」，
   改述为「thread 就是标准 object，save/load 自身数据 + 窗状态；窗持引用、对象持数据」）+ persistable/class self.md；
   统一修登记的坏测试、跑绿。

## 退役 / 保留清单

- **退役**：`PersistableModule.container`、`ThreadContainerPersistence`、`thread/persistable/thread-container.ts`、
  `Data.isCreatorWindow` 字段、`close` 里的 isCreatorWindow 运行时检查。
- **保留（归属原则证明它们是对的）**：`thread-context.json` / `_ref` / per-object `data.json`（窗=引用、
  对象=数据的分层）、`object-data.ts` 的 custom-or-default dispatch、路径原语、串行写、inbox per-message 目录。
- **conversationId 去状态化（2026-06-16 已落地）**：`conversationId` 恒等于窗实例 id，删 `Data` 字段；
  消费方一律用 `ctx.object.id` / `window.id`（readable renderHead 传入 id；前端 TalkWindowDetail 显示 window.id）。
- **可选理顺（不阻塞，落地时定）**：`thread-context.json` 是否并入 thread.json 单文件；`isForkWindow`
  可退化为寻址提示（findThreadInScope 命中与否自动判定 fork/peer 派送）——本轮**不动**，只登记方向。

## 验证

非测试源码 `tsc` 全程 0；thread save/load round-trip 运行时验证；storybook 控制面 PERS + 会话场景跑绿；
坏测试登记下方账本，全部源码改完后统一修。

> 基线注记：本分支测试已有 **574 个 pre-existing tsc 错误**（早先 composition wave 的已知坏测试，
> 非本重构引入；非测试源码基线 0 错误）。本重构只在此之上叠加少量，最终修测试时一并处理。

## 坏测试账本（本次重构，最后统一修）

### 增量 1：isCreatorWindow 去状态化
- **判据迁移**：任何测试 (a) 读 `window.isCreatorWindow` 或 (b) 在 data 里写 `isCreatorWindow: true`
  期望旧 projection/close 行为者，须改为「creator 窗 id = `creatorWindowIdOf(threadId)`」判定，
  close 不可关改为「self-view 投影不 surface close」预期。
- **已知 tsc 报错**：`core/executable/__tests__/tools.test.ts`（读 `.isCreatorWindow`）。
- **语义待迁移**（在 data 里写 isCreatorWindow / 断言它）：`core/thinkable/__tests__/context.test.ts`、
  `core/executable/__tests__/{sharing,wait,commands-execution,step2-windows,talk-fork-thread-tree}.test.ts`、
  `core/thinkable/context/__tests__/attention-tiering.test.ts`、
  `core/readable/__tests__/transcript-viewport-integration.test.ts`、
  `builtins/agent/children/thread/__tests__/{talk-delivery,thread-say}.test.ts`、
  `tests/e2e/backend/{context-compression-p0c-typed,plan-share-parent-child}.e2e.test.ts`、
  `tests/integration/{wait-state-transition,ooc6-object-unification}` 等。

### conversationId 去状态化
- **已知 tsc 报错**：`core/thinkable/__tests__/context.test.ts` 的 `as ContextWindow[]` cast（已就地删 conversationId 行）。
- **语义债**（在 data 里写 `conversationId: "..."`，无害的 dead 字段、不影响断言）：`wait` / `manager-method-dispatch` /
  `member-composition` / `peer-object-derive` / `attention-tiering` / `transcript-viewport-integration` /
  `thread-context-bypass-reload` 等测试 + 几个 e2e/integration——读取点早已用 id，SET 是 dead 字面量，
  最终修测试时随手删即可。
