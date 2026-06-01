# Runtime Object Persistence — Flat Directory + Context Registry Plan

**日期：** 2026-06-01
**修订对象：** [2026-05-28-ooc-object-unification-plan.md](./2026-05-28-ooc-object-unification-plan.md) 的 Phase 5
**关联设计：** [2026-05-28-ooc-object-unification-design.md](../specs/2026-05-28-ooc-object-unification-design.md) §7
**当前分支：** ooc-6
**当前 HEAD：** `bb5b46b`

---

## 1. 背景与动机

### 1.1 原 Phase 5 设计回顾

原 spec §7 把运行时创建的 OOC Object 持久化为 **嵌套 context tree**：

```
flows/<sessionId>/<parentObjectId>/
└── context/
    └── <newObjectId>/
        ├── window.json
        └── context/
            └── <grandchildObjectId>/
```

当前实现 (`packages/@ooc/core/persistable/flow-context.ts`) 已落地这一形态：
- `contextDir(ref, parentObjectId)` → `flows/<sid>/<parentId>/context/`
- `contextObjectDir(ref, parentId, contextId)` → `flows/<sid>/<parentId>/context/<contextId>/`
- `contextObjectFile(...)` → 上述目录下的 `window.json`
- `readContextObjectsRecursive(ref)` 沿 objectId 路径逐级读取所有祖先的 `context/`

`WindowManager.writeContextObjectForWindow` / `deleteContextObjectForWindow` 在窗口 open/close 时同步写入这一目录结构，`thread-json.readThread` 也已加入双读合并。

### 1.2 问题：context 是视角，不是归属

用户指出的根本性认知错误：

> ObjectFoo 运行时派生的其他对象，放在 `flows/<sessionId>/objects/<objectId>/context/<newObjectId>` 目录，但是我又想了想，这其实不对，**context 只是 ooc objects 的一种视角，ooc object 可以同时存在于多个 object 各自的 context 中**。

含义：
- 一个 OOC Object 是 first-class 实体，有自己的身份和持久化位置；
- "在某 thread 的 context 中"是一种 **关系/视角**，不是 **归属**；
- 同一个 Object 可被多个其他 Object 的 thread 同时纳入上下文（peer 关系、共享对象、cross-object talk_window 都属于这一类）；
- 把 Object 的存储位置嵌入某个 parent 的 `context/` 目录，等于把一种关系 hardcode 成唯一 home，破坏了多视角共享的可能。

### 1.3 新设计核心

> 运行时创建的对象实例，应该是由 creator 分配 objectId 后，**统一平铺输出在 `flows/<sessionId>/objects/<objectId>` 目录下**，然后 `flows/<sessionId>/objects/<objectId>/context.json` 文件负责记录当前 thread context 持有了哪些 objects，并记录 context window 参数。

转译为工程语义：

1. **Object 是一等存储单元**：每个 runtime-created object 在 `flows/<sid>/<oid>/` 拥有自己的目录，与 stone-defined object 完全对称。
2. **Context 是 thread 视角**：thread 通过一份 registry（context.json）声明"我当前持有哪些 object 进 context"，并附带每个 object 的 context window 参数（compressLevel、viewport、order 等纯展示态）。
3. **多视角共享天然成立**：Object A 同时被 thread T1 和 thread T2 引用，只是它们各自的 context.json 都列出了 A.objectId，A 自身的存储位置无需复制或软链。

---

## 2. 新数据模型

### 2.1 目录布局

> 路径术语说明：当前代码中 `objectDir()` 解析为 `flows/<sid>/<encoded objectId>`（嵌套段用 `children/` 隔开），`stones` migration 已移除 `objects/` 中间层（见 `common.ts:5-9`）。下文用户原话中的 "`objects/<objectId>`" 表述与代码中 `flows/<sid>/<objectId>` 同义，本文档统一使用代码侧的实际路径。

**Stone-defined object（持久身份）：**
```
flows/<sid>/agent_of_x/
├── .flow.json
├── threads/
│   └── <tid>/
│       ├── thread.json
│       └── context.json    ← 新增：thread-level context registry
└── (no context/ subdir)
```

**Runtime-created object（运行时派生的子对象，平铺到 flow root）：**
```
flows/<sid>/file_w_xyz/             ← creator 分配的 objectId，平铺
├── .flow.json
└── state.json                       ← 该 object 自身的状态（path / content / form data 等）
```

**对应的 thread context.json 内容：**
```json
{
  "version": 1,
  "members": [
    {
      "objectId": "file_w_xyz",
      "params": {
        "compressLevel": 0,
        "decayMeta": null,
        "order": 1
      }
    },
    {
      "objectId": "do_w_abc",
      "params": { "compressLevel": 0, "order": 2 }
    }
  ]
}
```

### 2.2 三类 object 的存储路径区分

| 类别 | 持久身份 | 路径形态 | 状态文件 |
|------|---------|---------|---------|
| Stone-defined（如 `agent_of_x`、`supervisor`） | yes，跨 session | `flows/<sid>/<id>/` | 由 stone 自身定义；通常无 state.json |
| Runtime-created builtin（如 `do_w_*`、`file_w_*`、`command_exec_*`） | session-scoped | `flows/<sid>/<id>/` | `state.json` 存全部 type-specific 字段 |
| Runtime-created custom（如外部场景派生的 `factor_group_*` 实例） | session-scoped | `flows/<sid>/<id>/` | `state.json` + 可选 prototype 引用 |

> 关键不变量：**所有 object 不论来源，在 flow 中都是同一种平铺布局**。"runtime-created" 只是分配时点的语义，存储上不做区分。

### 2.3 context.json schema（v1）

```typescript
interface ContextRegistry {
  version: 1;
  members: ContextMember[];
}

interface ContextMember {
  objectId: string;          // 关联到 flows/<sid>/<objectId>/
  params: ContextParams;     // 仅 thread-level 视图参数；不复制 object 自身状态
}

interface ContextParams {
  /** 压缩级别（替代 ContextWindow.compressLevel）。 */
  compressLevel?: number;
  /** 自然衰减运行时计数（替代 ContextWindow._decayMeta）。 */
  decayMeta?: { lastTouchedAt: number; idleRounds: number } | null;
  /** 在 context 中的展示顺序（取代当前 contextWindows[] 的数组下标）。 */
  order?: number;
  /** parent object reference（取代 ContextWindow.parentWindowId，仅对 form 等 child 关系有意义）。 */
  parentObjectId?: string;
}
```

**关键约束：**
- `params` 内只放 **视角参数**——同一个 object 在不同 thread 看到的 compressLevel/order 可以不同；
- `params` 不放 **object 状态**——所有 type-specific 字段（path/content/history/...）都属于 object 的 `state.json`；
- 历史的 `parentWindowId` 在新模型里降级为 thread-level relation（form 与其打开者的关系），不再是 object 全局属性。

---

## 3. 接口与 API 变更

### 3.1 删除：`flow-context.ts` 中嵌套 context tree API

以下符号在新模型下不再需要，移除（保留过渡期别名见 §6）：
- `CONTEXT_SUBDIR`
- `contextDir(ref, parentObjectId)`
- `contextObjectDir(ref, parentObjectId, contextId)`
- `contextObjectFile(ref, parentObjectId, contextId)`
- `readContextObjects(ref, parentObjectId)`
- `readContextObjectsRecursive(ref)`
- `writeContextObject(ref, parentObjectId, window)`
- `deleteContextObject(ref, parentObjectId, contextId)`

### 3.2 新增：runtime object 状态读写（`flow-runtime-object.ts`）

新文件 `packages/@ooc/core/persistable/flow-runtime-object.ts`：

```typescript
/** runtime-created object 的状态文件路径 = objectDir(ref)/state.json */
export function runtimeObjectStateFile(ref: FlowObjectRef): string;

/** 写 object 状态（type + 全部 type-specific 字段）。creator 调用。 */
export async function writeRuntimeObjectState(
  ref: FlowObjectRef,
  state: ContextWindow,    // 暂时复用 ContextWindow 类型；type 字段决定如何 deserialize
): Promise<void>;

/** 读 object 状态。返回 undefined 表示 object 不存在或已删除。 */
export async function readRuntimeObjectState(
  ref: FlowObjectRef,
): Promise<ContextWindow | undefined>;

/** 删除 object 目录（含 state.json + 自身 threads/）。close 时调用。 */
export async function deleteRuntimeObject(ref: FlowObjectRef): Promise<void>;

/** 仅当 stone 不存在时为 runtime object 创建 .flow.json + state.json。 */
export async function createRuntimeObject(
  ref: FlowObjectRef,
  state: ContextWindow,
): Promise<void>;
```

### 3.3 新增：thread context registry（`flow-context-registry.ts`）

新文件 `packages/@ooc/core/persistable/flow-context-registry.ts`：

```typescript
import type { ThreadPersistenceRef } from "./common";

export interface ContextRegistry {
  version: 1;
  members: ContextMember[];
}

/** path = threadDir(ref)/context.json */
export function contextRegistryFile(ref: ThreadPersistenceRef): string;

/** 读 thread 的 context registry；未写过返回 { version: 1, members: [] }。 */
export async function readContextRegistry(
  ref: ThreadPersistenceRef,
): Promise<ContextRegistry>;

/** 整体写 thread context registry（被 manager.flush 调用）。 */
export async function writeContextRegistry(
  ref: ThreadPersistenceRef,
  registry: ContextRegistry,
): Promise<void>;
```

### 3.4 改造：`WindowManager`

`packages/@ooc/core/executable/windows/_shared/manager.ts`：

| 方法 | 现状（嵌套 context/） | 新行为（flat + registry） |
|------|----------------------|--------------------------|
| `openCommandExec` | `writeContextObject(ref, ref.objectId, form)` | `writeRuntimeObjectState(formRef, form)` + 标记 registry dirty |
| `insertTypedWindow` | 同上 | `writeRuntimeObjectState(windowRef, window)` + registry dirty |
| `upsertWindow` | 同上 | `writeRuntimeObjectState(windowRef, window)` + registry dirty |
| `removeWindow` | `deleteContextObject(ref, ref.objectId, id)` | 1) registry 中移除该 objectId；2) 若没有其他 thread 引用则 `deleteRuntimeObject(ref)`（reference counting） |
| `toData()` | 返回 `ContextWindow[]` 用于 `thread.contextWindows` | **保留**（兼容期 thread.json 仍写） |
| 新增 `toRegistry(): ContextRegistry` | — | 把当前 mgr 中每个 window 翻译为 `ContextMember`（id + params） |
| 新增 `flushRegistry(threadRef)` | — | 写 `context.json` 到 thread dir |

> **runtime object FlowObjectRef 推导：** runtime object 是平铺的，所以 `ref.objectId` 直接等于 `window.id`，不再嵌入到 parent 的路径下。
> ```ts
> function runtimeObjectRef(thread: ThreadContext, windowId: string): FlowObjectRef {
>   const t = thread.persistence!;
>   return { baseDir: t.baseDir, sessionId: t.sessionId, objectId: windowId };
> }
> ```

> **reference counting：** "其他 thread 是否引用"通过扫描同一 `flows/<sid>/` 下所有 `*/threads/*/context.json` 中的 `members[].objectId` 实现。close 时若发现仍被别人引用，**只移出 registry 不删 object 目录**——保证 multi-context 共享下不会被某个 thread 误删。

### 3.5 改造：`thread-json.readThread` / `writeThread`

`packages/@ooc/core/persistable/thread-json.ts`：

- `readThread`：
  1. 从 `thread.json.contextWindows[]` 读取（兼容旧数据）；
  2. 读 `context.json`（registry）；对每个 member 调 `readRuntimeObjectState(...)` 拼回 `ContextWindow`，附加 `params` 中的视角字段；
  3. 合并：registry 中存在的 id → 用 registry 版本（权威）；旧 `contextWindows[]` 中存在但 registry 没有 → 视为 legacy entry，填充进 mgr 但 warn（迁移路径，见 §5）；
  4. 不再调 `readContextObjectsRecursive`（删除）。
- `writeThread`：
  1. 写 `thread.json`（保留 `contextWindows[]`，兼容期）；
  2. 通过 `WindowManager.flushRegistry` 写 `context.json`。

---

## 4. 工程阶段拆分

新 Phase 5 仍然分 4 个子阶段，但语义全面更新：

### P5'.1 — 新数据通道（双写并存）

**目标：** 落地 `flow-runtime-object.ts` + `flow-context-registry.ts`；保留旧嵌套 context 路径不删除，验证新通道可独立工作。

**改动点：**
1. 新建 `flow-runtime-object.ts` 与 `flow-context-registry.ts`（API 见 §3.2、§3.3）。
2. `WindowManager` 写路径加分支：在写 `context/<id>/window.json` 的同时，也写 `state.json` 到平铺路径 + 累积 registry diff。
3. `WindowManager.flushRegistry(threadRef)` 在 `writeThread` 末尾调用，落地 `context.json`。
4. **不动读路径**——`readThread` 仍走旧 `readContextObjectsRecursive` + `thread.contextWindows[]`，这一阶段新通道只验证能写出正确数据。
5. 单元测试覆盖：
   - 写一个 do_window，校验 `flows/<sid>/<windowId>/state.json` 与 `flows/<sid>/<oid>/threads/<tid>/context.json` 同时存在；
   - registry 中 `members[*].params` 不包含 type-specific 字段；
   - reference counting 的 dry-run：手动构造两个 thread 同时引用一个 object，删除其中一个 thread 不删除 state.json。

**风险：** 低。旧路径完全保留，新路径只加，破坏面有限。

**rollback：** revert 单一提交即可。

### P5'.2 — 切换读路径到新模型

**目标：** `readThread` 改用 `flow-runtime-object` + `flow-context-registry`。

**改动点：**
1. `readThread`：
   - 读 `context.json` → registry；对每个 member 读 `state.json` 拼回 ContextWindow；
   - 仍然合并 `thread.contextWindows[]` 中 registry 没有的 entry（legacy fallback，warn）；
   - 删除 `readContextObjectsRecursive` 调用。
2. `WindowManager.fromThread` 改为接收已合并的 list（接口不变，但保证传入数据已是新模型解码后的 ContextWindow）。
3. e2e 测试一遍：跑一个完整 thinkloop，verify thread.contextWindows[] 与 context.json 一致；冷重启后能恢复。

**风险：** 中。读路径切换可能命中遗留嵌套 context 数据导致 dropped windows。**强制要求：** 在 `.ooc-world` 下手动跑一遍 e2e、跑一遍 ad-hoc 真 session，验证 close form 后 mgr / 文件系统两边一致。

**rollback：** revert 此阶段提交，回到 P5'.1 状态（双写但读旧路径）。

### P5'.3 — 删除嵌套 context API + 清理 thread.contextWindows[] 写入

**目标：** 移除旧路径；`thread.contextWindows[]` 字段保留但不再写入。

**改动点：**
1. 删除 `flow-context.ts` 中的 8 个符号（§3.1）。物理上保留文件作为占位 + deprecation comment，或直接删除文件并清理 `index.ts` re-export。**推荐：** 删除文件——这是 pre-production 阶段，clean cut 优于墓碑。
2. `WindowManager` 移除写 `context/<id>/window.json` 分支；只走平铺 + registry。
3. `writeThread.stripVolatileForPersist`：`contextWindows` 保留 strip 逻辑，但写入空数组（让旧数据自然衰减）；或在写入前打 deprecation warn。
4. 删除 `thread-json.readThread` 中对 `readContextObjectsRecursive` 的兼容代码（已在 P5'.2 移除调用，这里彻底从源代码 remove import）。
5. 升级现有的 `__tests__/flow-context.test.ts` → `__tests__/flow-runtime-object.test.ts` + `__tests__/flow-context-registry.test.ts`。

**风险：** 中。会让任何在 .ooc-world 下用旧嵌套 context 写过的 session 丢失 runtime objects（仅 `thread.contextWindows[]` 还能读）。**前提：** P5'.2 完整跑过 e2e 验证。

### P5'.4 — 移除 thread.contextWindows[]

**目标：** 字段下架，模型完全切到 registry。

**改动点：**
1. `ThreadContext.contextWindows` 字段从类型移除（在 `thinkable/context.ts`）。
2. mgr.toData() / fromThread() 移除 contextWindows 通路。
3. 旧 `thread.json` 的迁移：`readThread` 在解析时若发现 `contextWindows[].length > 0` 且无对应 `context.json`，自动把 entries 翻译为 registry 写回（一次性 migration）。
4. `service.ts:stripVolatileForHash` 同步更新，避免 hash 永远翻动（见用户 memory `feedback_thread_hash_strip_volatile.md`）。

**风险：** 高。任何还引用 `thread.contextWindows` 的代码（包括 web）都要清理。grep 先做 audit；缺一处就回滚。

---

## 5. 迁移策略

### 5.1 .ooc-world 下的存量数据

`packages/@ooc/core/__tests__/` 与 `.ooc-world/flows/` 下可能有：
- 旧嵌套 `context/<id>/window.json` 数据（P5.1/P5.2 已落地的产物）
- 旧 `thread.json.contextWindows[]` 数据

**P5'.2 read path 处理：**
1. 优先读 `context.json`；
2. fallback：读 `thread.contextWindows[]`；
3. **不**自动从旧嵌套 `context/<id>/window.json` 读——这是已废弃的 transient 路径，pre-production 接受丢失。

**P5'.4 write-back migration：** 一次性把 `thread.contextWindows[]` 翻译为 registry，写完后清空字段。

### 5.2 多视角共享数据如何形成

第一个真实场景：cross-object talk_window。
- supervisor thread T1 在自己的 context 中开了 `talk_w_abc`；
- agent_of_x thread T2 也想加入这个对话 → 在 T2 自己的 context.json 中追加 `{ objectId: "talk_w_abc", params: {...} }`；
- `talk_w_abc` 的 state（messages 列表）只在 `flows/<sid>/talk_w_abc/state.json` 存一份；
- 两个 thread 看到的是同一份消息流；写入由 talk_window 的 method 控制并发（与本 plan 无关）。

> 这一场景就是 spec §9（Peer/Children Auto-Entry）的工程基础——auto-inject 的实现就是把 peer.objectId 加到 registry。

### 5.3 reference counting 实现细节

`removeWindow` 删 object 目录时，必须先扫描整个 `flows/<sid>/*/threads/*/context.json`：
- 简单实现：每次 close 时全表扫描（session 内 thread 数量 ≤ 几十，可接受）；
- 优化：runtime 维护 in-memory ref count；落盘前 verify。

**初版用全表扫描，留 TODO comment。**

---

## 6. 兼容性处理

`flow-context.ts` 中的旧符号在 P5'.3 删除时一刀切，不留 deprecation alias——理由：
- 这是 ooc-6 内部接口，外部 stone 不依赖；
- 检索范围明确（`packages/@ooc/core/` + `__tests__/`）；
- 留 alias 反而让 sub-agent 误以为是稳定 API。

在 P5'.3 提交说明里附 **breaking change** 标记并列出移除的符号，便于 git log 检索。

---

## 7. 测试矩阵

### 7.1 单元测试

| 测试文件 | 覆盖 |
|---------|------|
| `flow-runtime-object.test.ts`（新） | createRuntimeObject / readRuntimeObjectState / writeRuntimeObjectState / deleteRuntimeObject 路径正确、ENOENT graceful |
| `flow-context-registry.test.ts`（新） | readContextRegistry 默认 v1 空、写读 round-trip、unknown version 拒读 fail-loud |
| `flow-context.test.ts`（删除） | — |
| `manager.test.ts`（更新） | openCommandExec 写出 state.json + registry entry；submit 修改 registry params；close 触发 ref-count 检查 |
| `thread-json.test.ts`（更新） | readThread 拼回 ContextWindow 内容与 mgr.fromThread 等价；writeThread 落地 context.json |

### 7.2 集成测试

`tests/e2e/` 下加一个新场景：
- 名称：`runtime-object-flat-persistence.e2e.ts`
- 场景：开 do_window → exec command → close form → 重启 thread → 验证全部 window 状态恢复 + context.json 内容。

### 7.3 多视角共享场景测试

新增一个最小测试：
- 创建 object A（runtime object）；
- 在 thread T1 和 thread T2 的 registry 中都引用 A；
- 在 T1 close A → 仅从 T1.context.json 移除，A 的目录与 T2.context.json 中的引用都不动；
- 在 T2 close A → A 目录被删除。

### 7.4 hash 稳定性

P5'.4 完成后跑一遍 `getThread` 多次取 hash 验证不翻动（user memory `feedback_thread_hash_strip_volatile.md`）。

---

## 8. 影响面 grep 清单

执行各阶段前必须 grep 的符号 / 路径：

| 符号 | 影响范围 | 触达数（参考） |
|------|---------|---------------|
| `writeContextObject` | manager.ts | 1 file |
| `deleteContextObject` | manager.ts | 1 file |
| `readContextObjectsRecursive` | thread-json.ts | 1 file |
| `contextDir` / `contextObjectDir` / `contextObjectFile` | flow-context.test.ts | 1 file |
| `thread.contextWindows` | 全 packages，含 web | **大**，需独立 audit pass |
| `CONTEXT_SUBDIR` | flow-context.ts | 1 file |

每阶段 PR description 必须列：
- 删了什么符号
- 新增的对外 API
- grep 验证 0 残留的命令

---

## 9. 风险与回滚

### 9.1 主要风险

| 风险 | 阶段 | 缓解 |
|-----|------|------|
| ref-counting 全表扫描在大 session 下慢 | P5'.1 | TODO + 在 e2e 测 100-window session 性能 |
| 旧嵌套 context 数据丢失 | P5'.3 | pre-production 可接受；commit message 高声明 |
| `thread.contextWindows` 还有未发现的 reader | P5'.4 | grep audit + 单元测试覆盖 |
| context.json 与 thread.json 之间一致性窗口 | 全程 | 写顺序：先 state.json → 再 thread.json → 再 context.json；崩溃后以 thread.json 为准重建 registry |

### 9.2 回滚点

| 回滚到 | 含义 |
|--------|------|
| P5'.1 失败 | 直接 revert，回到 `bb5b46b` |
| P5'.2 失败 | revert 读路径切换提交，保留 P5'.1 的双写代码 |
| P5'.3 失败 | revert 删除符号的提交（git checkout HEAD~ 恢复 flow-context.ts） |
| P5'.4 失败 | revert 字段移除提交，contextWindows[] 字段恢复 |

### 9.3 中止条件

- 任一阶段 e2e 出现 **runtime object 状态丢失或错乱**（不是 dropped legacy entry，而是新写入的 object 读不回来）；
- `getThread` hash 在多次取时翻动（registry 序列化不稳定）；
- ref-counting 出现误删（A 被 T1+T2 引用，T1 close 把 A 删了导致 T2 失效）。

任一项命中，立即停在当前阶段并回滚一档。

---

## 9.5 Phase 5'.5 — readable.ts 抽取（与 P5' 并行可独立推进）

### 9.5.1 现状

按 spec §6 的目标 stone object 布局：

```
<id>/
├── self.md
├── readable.md      ← 静态上下文展示
├── readable.ts      ← 动态上下文展示（renderXml 的 home）
├── executable/      ← 方法实现
└── visible/         ← UI 实现
```

但 9 个 builtin 当前把 renderXml 全部塞在 `executable/index.ts` 里，与 `registerObjectType` 注册调用混在一起：

| builtin | 现状 | renderXml 出现次数 |
|---------|------|--------------------|
| command_exec | `executable/index.ts:48` `function renderCommandExec` | 2 |
| file | `executable/index.ts` | 2 |
| knowledge | `executable/index.ts` | 2 |
| plan | `executable/index.ts:464` | 4（含子 helper） |
| program | `executable/index.ts` | 2 |
| root | `executable/index.ts` | 2 |
| search | `executable/index.ts` | 2 |
| skill_index | `executable/index.ts` | 2 |
| todo | `executable/index.ts` | 2 |

**问题：**
- `executable/` 的语义是"方法实现（method body）"，把"我如何在 context 里被渲染"塞进去——污染了维度边界（observable/readable 的展示能力被混入 executable）；
- spec 早就规划了 `readable.ts`；目前 `ObjectDefinition` 已有 `readable?: ReadableFn` 字段且 boot validation 接受 `renderXml` 或 `readable` 任一（`registry.ts:341-353`）——这是只剩搬家工作的"半完成"状态；
- 后续给 stone-defined object 提供"用户编辑 readable.ts 控制渲染"能力时，builtin 自己的渲染分散在 executable 里会变成反例。

### 9.5.2 目标

每个 builtin 拆出独立的 `readable.ts`：

```
packages/@ooc/builtins/<type>/
├── executable/
│   ├── index.ts          ← registerObjectType 调用 + 方法注册（renderXml 引用换成 readable）
│   └── command.*.ts      ← 各 command 实现（不动）
├── readable.ts           ← export default function render(ctx): XmlNode[]
├── readable.md           ← 不动
├── self.md               ← 不动
├── visible/              ← 不动
├── types.ts              ← 不动
└── index.ts              ← 不动
```

`readable.ts` 可以 import `./executable/` 下的任何 helper（比如 plan 的子节点渲染辅助、program 的 history viewport 计算）——这是允许的方向（readable 依赖 executable，反向不允许）。

### 9.5.3 改造步骤（per-builtin，逐个迁移）

每个 builtin 的迁移是 **5 步纯机械操作**：

1. **新建 `readable.ts`**：
   - 把 `executable/index.ts` 中的 `function render<X>(ctx: RenderContext): XmlNode[]` 整段剪到 `readable.ts`；
   - 复制必要的 `import { xmlElement, xmlText, ... } from "@ooc/core/thinkable/context/xml.js"`；
   - 改函数签名命名为 `export default function readable(ctx)` 或 `export function readable(ctx)`（建议 named export，方便单元测试）；
   - 类型签名 `(ctx: ReadableContext) => XmlNode[] | Promise<XmlNode[]>`，与 `RenderContext` 同形（spec §6.6 已对齐）。
2. **更新 `executable/index.ts`**：
   - 删除 renderXml 函数定义；
   - `import { readable } from "../readable.js";`；
   - `registerObjectType("<type>", { ... renderXml: renderX, ... })` → `registerObjectType("<type>", { ... readable, ... })`。
3. **跑该 builtin 相关单元测试**：每个 builtin 都有自己的 renderXml 单测（如 `program-history-viewport.test.ts:107` 直接 `def.renderXml!({ thread, window })`）。这一步会失败——见步骤 4。
4. **更新单测调用位置**：
   - 若测试通过 `getWindowTypeDefinition("<type>").renderXml` 调用——改为 `.readable`；
   - 或更直接：测试改为 `import { readable } from "@ooc/builtins/<type>/readable.js"; readable({ thread, window })`，绕过 registry。
5. **`bun tsc --noEmit` 全局过一遍** + 跑 `bun test` 那个 builtin 的测试集。

### 9.5.4 渲染调度层（buildContext）的兼容性

`packages/@ooc/core/thinkable/context/render.ts`（或同等位置）当前应该读 `def.renderXml(ctx)`。新 readable.ts 落地后，调度层需要按 spec §C1（"新流程"）的优先级处理：

```
优先级：readable (def.readable / readable.ts 导出) > readable.md > 默认渲染
```

实操：
- `def.readable` 存在 → 调它，输出包成 `<readable>` 或保持原 `<window>` wrapper（沿用现状）；
- `def.readable` 不存在 + 有 readable.md → 把 md 内容包成 `<readable>` 节点（仅适用于 stone-defined object；builtin 都会有 readable）；
- 都没有 → 走默认渲染（应当不会发生，boot validation 会 fail-loud）。

**本 plan 范围内，调度层只做最小改动：把读 `def.renderXml` 的位置改为读 `def.readable ?? def.renderXml`。** 完整的 readable.md 兼容性可以在 spec §6 的更大改造中处理；这里只解决 builtin 抽取后注册侧用 `readable` 字段不再塞 `renderXml` 的问题。

### 9.5.5 推进顺序

按风险从低到高（每提交一个 builtin 跑一次 tsc + 该 builtin tests）：

1. `todo`（最简单，~30 行 renderXml）
2. `file`
3. `search`
4. `knowledge`
5. `command_exec`
6. `skill_index`
7. `root`
8. `program`（涉及 history viewport，单测多）
9. `plan`（最复杂，4 个 renderXml-related helpers）

每步骤独立提交，commit message 形如：
```
refactor(ooc-6): extract <type> renderXml → readable.ts
```

### 9.5.6 与 P5' 的依赖关系

完全独立。P5'.1–P5'.4 关心 **持久化路径与 context registry**，P5'.5 关心 **builtin 内部代码组织**。两者可并行；推荐优先做 P5'.5（小、机械、零风险），先把代码组织清干净，再开 P5'。

### 9.5.7 验收

- 9 个 builtin 都有 `readable.ts`；
- `executable/index.ts` 中没有 renderXml 函数定义；
- `registerObjectType` 调用都用 `readable: ...` 字段，不再用 `renderXml: ...`；
- 单元测试全绿；
- `bun tsc --noEmit` 通过；
- `def.renderXml`（旧字段）在 builtin 注册侧 0 处使用（调度层兼容兜底保留可读访问，但不再被 register）。

### 9.5.8 风险与回滚

- **风险：** 低。纯机械搬家，不改运行时行为；唯一可能踩坑是单测直读 `def.renderXml` 的地方漏改（导致 `undefined` is not a function）。
- **回滚：** 单 builtin 提交粒度，问题出现时回滚单个 commit 即可。
- **不做的事：**
  - 不在本阶段碰 stone-defined object 的 readable.ts 加载（那是 spec §6 全套，需要更大改造）；
  - 不修改 readable.md 加载逻辑（spec Phase 3 已落地，按状态 doc §2.1 表 Phase 3 标记为完成）；
  - 不改 `RenderContext` / `ReadableFn` 的类型签名；
  - 不改 `def.renderXml` 与 `def.readable` 的字段名（保持 spec 既定方向）。

---

## 10. 与原 spec / 原 plan 的差异总结

| 维度 | 原 plan P5 | 本 plan P5' |
|------|-----------|------------|
| Object 存储路径 | `flows/<sid>/<parent>/context/<id>/` 嵌套 | `flows/<sid>/<id>/` 平铺 |
| Object 状态文件 | `context/<id>/window.json` | `<id>/state.json` |
| Thread context 表达 | 嵌套目录隐式表达 | `context.json` 显式 registry |
| 多视角共享 | 不支持（一个 home parent） | 天然支持（多份 registry 引用同一 oid） |
| `thread.contextWindows[]` | 计划最终删除 | 同样最终删除（迁移到 registry） |
| 读路径合并策略 | context/ 优先 + thread.contextWindows fallback | registry 优先 + thread.contextWindows fallback |
| 移除原嵌套 context API | 不需要（原本就这么设计） | **必须**（§3.1 列表） |
| readable.ts 抽取 | 未列入 P5 | 新增 P5'.5（与 P5'.1–4 独立可并行） |

设计哲学层差异：
- 原方案把 context 作为 object 的"归属"——一个 object 只能有一个 parent；
- 新方案把 context 作为 thread 的"视角"——object 是 first-class，thread 通过 registry 声明视角内容。

后者对齐 OOC 的根本理念："Object 是一等公民"——object 的存储位置不应被某个上下文关系绑架。

---

## 11. 启动条件

本 plan 可以启动的前置条件：

1. ✅ 现状代码 (`bb5b46b`) tsc / tests / check scripts 全绿；
2. ✅ 原 plan §Phase 5 的双写部分作为 baseline 已落地；
3. ⏳ 用户确认本 plan（特别是 §2.3 schema 和 §3.4 reference counting 策略）；
4. ⏳ 原 plan 文档（2026-05-28-ooc-object-unification-plan.md）的 §Phase 5 章节标记为 superseded by this plan，避免后续 sub-agent 取错指引；

---

## 12. Open Questions

1. **context.json 放在 thread 还是 object 层？**
   - 用户原话："`flows/<sessionId>/objects/<objectId>/context.json`"——object 层。
   - 工程考量：一个 object 可能有多个 thread，每个 thread 的 context 不同（compressLevel/order 因 thread 而异）。
   - **本 plan 选择：thread 层（`threads/<tid>/context.json`）**，理由：context window 参数本来就是 thread-scoped；object 层若多 thread 会冲突。
   - 需用户确认。

2. **runtime object 能否升级为 stone object？**
   - 当前模型下两者存储路径同构，理论上 runtime → stone 升级只是 promote 一份 state.json + 加 self.md/readable.md。
   - 不在本 plan 范围，留 TODO。

3. **`state.json` vs 沿用 `window.json` 命名？**
   - state.json 与 spec §6 stone object 的命名对齐，更通用；
   - window.json 与现状代码一致，迁移轻量。
   - **本 plan 选择：`state.json`**——object unification 的精神就是把"window"这一术语降级，存储层不应再保留 window 字面值。

4. **legacy 数据 best-effort 迁移还是 hard cut？**
   - 当前是 pre-production，hard cut 简单；
   - 但用户的 .ooc-world 下可能积累了几周测试数据。
   - **本 plan 选择：P5'.4 做一次性 thread.contextWindows[] → registry 自动迁移；嵌套 context/ 数据放弃。**
