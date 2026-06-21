# 对象激活生命周期（unactive→canceled 经 refcount）实现 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans。步骤用 `- [ ]` 跟踪。
> **配套 spec**：`docs/2026-06-21-object-activation-lifecycle-design.md`（读它建模型）。
> 已过 4-lens 对抗 review + 用户细化轮（spec §10）。剩低风险确认点：spec §7 D1（failed 是否排除）。

**Goal:** thread `close` 方法塌回纯原语；引入可选 `unactive` 生命周期钩子——core 在 session(内存树)refcount 归 0 时**泛型**派发；thread 的 `unactive` 把（fork 子）线程切到新终态 `canceled` 并级联停用子树。construct 标记结构窗 `closable:false`，close 原语 honor。`active?` 仅类型槽。

**Architecture:** core 泛型机制（refcount + 单次 dispatch，复用 dead `destruct?` 槽，零 thread import）；builtin 提供 body（v1 仅 thread，含级联 policy）。与 `construct` dispatch 同构。refcount 当场算、内存树、无持久索引、fast-path。

**Tech Stack:** TypeScript / bun；`bun:test`；`WindowManager`/`ObjectRegistry`/`findChild`/`initContextWindows`。

**测试策略（`feedback_refactor_defer_test_fixes`）：** 净新增模块（Phase 1）TDD-green；跨切改动保持源码连贯、坏测试登记 `WAVE-LIFECYCLE-broken-tests.md`、Phase 5 统一跑绿。每 Phase 末 commit。

**全局门禁（Phase 5 末全绿）：** `bun run test:storybook`；`bun test packages/@ooc/builtins/agent/children/thread`；`bun test packages/@ooc/core/{persistable,runtime,executable}`；e2e fork-cancel 跨 reload。

---

## 文件结构

**新建：** `core/runtime/object-lifecycle.ts`（`referencedObjectId` fork-only + `countSessionReferences` 内存树 + `dispatchUnactiveIfZero` 单次泛型；**零 thread import**）；`core/runtime/__tests__/object-lifecycle.test.ts`；`WAVE-LIFECYCLE-broken-tests.md`（临时）。

**修改：** `contract.ts:184-195`（`ObjectLifecycleHook`+`LifecycleContext`）；`ooc-class.ts:17,49,75-84`（`active?`/`unactive?` + `OocObjectInstance.closable?`）；`_shared/types/thread.ts:398`（`ThreadStatus` 加 `canceled`）；`app/server/modules/flows/model.ts:71`（UI union 加 canceled）；`object-registry.ts:117-165`（resolve* + merge）；`tools/close.ts`（closable 守卫 + unactive 派发）；`thinkable/context/init.ts`（creator 窗标 closable:false）；`thread/index.ts:181-186`（`Class.unactive`）；`thread/.../session-methods.ts`（删 closeMethod）；`thread/.../readable/index.ts:99`（去 close）；`app/server/runtime/worker.ts:298`（canceled 同终态）。

**v1 不做（phase-2）：** active 派发；session 盘扫；独立成员 unactive；peer/独立对象 canceled。

---

## Phase 0：契约 + OocClass + status + registry

### Task 0.1：契约 `ObjectLifecycleHook` + `LifecycleContext`

**Files:** Modify `core/executable/contract.ts:184-195`

- [ ] **Step 1：替换 `ObjectDestructor`（184-195）为**

```ts
export interface LifecycleContext extends ConstructorContext {
  /** refcount 跨 0↔1 的对象 id（钩子 body 据此定位自己要操作的对象）。 */
  targetId: string;
}
/** unactive 返回值：delete:true → core 把 object 彻底从 session 移除（含持久化文件）；缺省=只停用。 */
export interface UnactiveResult { delete?: boolean }

/**
 * 对象生命周期钩子（active/unactive 共用）—— 与 construct 对称、按 refcount 0↔1 触发。
 * 与 construct 签名不同：作用于既有对象、不产 Data；body 经 ctx（thread + targetId）自解析目标。
 * 皆可选。无独立 destruct —— OOC object 默认持久身份；unactive 可经返回 {delete:true} 自决彻底删除
 * （refcount-0-gated，故无悬空引用）。仅 unactive 路径 honor delete；active 返回值忽略。
 */
export interface ObjectLifecycleHook {
  description: string;
  exec: (ctx: LifecycleContext) => void | UnactiveResult | Promise<void | UnactiveResult>;
}
```

- [ ] **Step 2：** `grep -rn "ObjectDestructor\|\.destruct\b" packages/@ooc --include="*.ts" | grep -v __tests__` → 仅 ooc-class.ts，余登记账本。
- [ ] **Step 3：commit** `refactor(executable): ObjectDestructor → ObjectLifecycleHook + LifecycleContext`

### Task 0.2：OocClass 槽 + `OocObjectInstance.closable?`

**Files:** Modify `core/runtime/ooc-class.ts:17,49,75-84`

- [ ] **Step 1：** 行 17 import 改 `ObjectLifecycleHook`；行 49 `destruct?` →

```ts
  active?: ObjectLifecycleHook;   // v1 仅类型槽（dispatch 待首个 active body，spec §6）
  unactive?: ObjectLifecycleHook;
```

- [ ] **Step 2：** `OocObjectInstance`（75-84）加字段：

```ts
  /** 结构窗保护：construct 标 false → close 原语拒关（缺省 undefined = 可关）。spec §5。 */
  closable?: boolean;
```

- [ ] **Step 3：** `bunx tsc --noEmit -p packages/@ooc/core 2>&1 | grep ooc-class` → 无错。
- [ ] **Step 4：commit** `refactor(runtime): OocClass active?/unactive? 槽 + OocObjectInstance.closable?`

### Task 0.3：`ThreadStatus` 加 `canceled` + UI union

**Files:** Modify `_shared/types/thread.ts:398`、`app/server/modules/flows/model.ts:71`

- [ ] **Step 1：** `thread.ts:398` `export type ThreadStatus = "running" | "waiting" | "done" | "failed" | "paused" | "canceled";`
- [ ] **Step 2：** `flows/model.ts:71` UI status union 同加 `| "canceled"`。
- [ ] **Step 3：登记账本**：任何对 ThreadStatus 做穷举 switch 的地方（编译期若报 non-exhaustive 即列）。
- [ ] **Step 4：commit** `feat(thread): ThreadStatus 加 canceled 终态（refcount 退出态，spec §2.2）`

### Task 0.4：registry `resolveActive`/`resolveUnactive` + merge 保留

**Files:** Modify `core/runtime/object-registry.ts`

- [ ] **Step 1：照 `resolveConstructor`（159-165）for 循环**（`selfThenChain(classId)` 返回 class-id 链数组；**勿用 `getClass`**）

```ts
resolveActive(classId: string): ObjectLifecycleHook | undefined {
  for (const cid of this.selfThenChain(classId)) { const h = this.store.get(cid)?.active; if (h) return h; }
  return undefined;
}
resolveUnactive(classId: string): ObjectLifecycleHook | undefined {
  for (const cid of this.selfThenChain(classId)) { const h = this.store.get(cid)?.unactive; if (h) return h; }
  return undefined;
}
```

- [ ] **Step 2：** merge 块（117-121）补：`active: cls.active ?? existing?.active,` 与 `unactive: cls.unactive ?? existing?.unactive,`。
- [ ] **Step 3：** `bunx tsc --noEmit -p packages/@ooc/core 2>&1 | grep object-registry` → 无错。
- [ ] **Step 4：commit** `feat(runtime): registry.resolveActive/resolveUnactive + merge 保留`

---

## Phase 1：`object-lifecycle.ts`（TDD-green，泛型，零 thread import）

### Task 1.1：`referencedObjectId`（fork-only）

**Files:** Create `object-lifecycle.ts` + test

- [ ] **Step 1：失败测试**（真实 `OocObjectInstance` 形状，无 `_ref`）

```ts
import { test, expect } from "bun:test";
import { referencedObjectId } from "../object-lifecycle.js";
import { threadWindowIdOf } from "../../_shared/types/context-window.js";
test("fork 窗 → targetThreadId", () => {
  expect(referencedObjectId({ id: "w1", class: "_builtin/agent/thread", status: "open", data: { isForkWindow: true, targetThreadId: "t_child" } } as any)).toBe("t_child");
});
test("self 门面窗 → undefined", () => {
  expect(referencedObjectId({ id: threadWindowIdOf("t_self"), class: "_builtin/agent/thread", status: "open", data: { isForkWindow: true, targetThreadId: "t_self" } } as any)).toBeUndefined();
});
test("peer 窗 → undefined", () => {
  expect(referencedObjectId({ id: "w_peer", class: "_builtin/agent/thread", status: "open", data: { target: "alice", targetThreadId: "t_alice" } } as any)).toBeUndefined();
});
```

- [ ] **Step 2：FAIL。** **Step 3：实现**

```ts
// object-lifecycle.ts —— core 泛型对象生命周期：refcount + unactive 派发。零 thread builtin import。
import type { OocObjectInstance } from "./ooc-class.js";
import { isSelfThreadWindow } from "../_shared/types/context-window.js";
import { isTalkLikeClass } from "../_shared/types/constants.js";

/** 窗 → 它引用、生命周期由本窗持有的对象 id。v1 仅 fork（其余 undefined）。内存窗无 _ref。 */
export function referencedObjectId(w: OocObjectInstance): string | undefined {
  if (isTalkLikeClass(w.class)) {
    const d = (w.data ?? {}) as { isForkWindow?: boolean; targetThreadId?: string };
    if (d.isForkWindow && d.targetThreadId && !isSelfThreadWindow(w.id)) return d.targetThreadId;
  }
  return undefined;
}
```

- [ ] **Step 4：绿。Step 5：commit** `feat(lifecycle): referencedObjectId（v1 fork-only）`

### Task 1.2：`countSessionReferences`（内存树，排除 done/failed/canceled）

**Files:** Modify `object-lifecycle.ts` + test

- [ ] **Step 1：失败测试**

```ts
import { countSessionReferences } from "../object-lifecycle.js";
const thr = (id: string, status: string, windows: any[]) => ({ id, status, contextWindows: windows, childThreads: {} } as any);
test("fork 子仅被父 fork 窗引用 → 1；父去窗 → 0", () => {
  const p = thr("t_p", "running", [{ id: "w_f", class: "_builtin/agent/thread", status: "open", data: { isForkWindow: true, targetThreadId: "t_c" } }]);
  expect(countSessionReferences(p, "t_c")).toBe(1); p.contextWindows = []; expect(countSessionReferences(p, "t_c")).toBe(0);
});
test("canceled 线程的引用不计数", () => {
  const c = thr("t_c2", "canceled", [{ id: "w", class: "_builtin/agent/thread", status: "open", data: { isForkWindow: true, targetThreadId: "x" } }]);
  const p = thr("t_p2", "running", []); p.childThreads = { t_c2: c };
  expect(countSessionReferences(p, "x")).toBe(0);
});
```

- [ ] **Step 2：FAIL。Step 3：实现**

```ts
import type { ThreadContext } from "../_shared/types/thread.js";
const ACTIVE_STATUS = new Set(["running", "waiting", "paused"]); // 退出态 done/failed/canceled 排除（spec §2.2/§3.2）
function reachableThreads(start: ThreadContext): Map<string, ThreadContext> {
  const out = new Map<string, ThreadContext>();
  const down = (t: ThreadContext) => { if (!t || out.has(t.id)) return; out.set(t.id, t); for (const c of Object.values(t.childThreads ?? {})) down(c as ThreadContext); };
  let root = start; while ((root as any)._parentThreadRef) root = (root as any)._parentThreadRef; down(root); return out;
}
/** session 内存树非退出态线程中，外部引用 targetId 的窗数（自引用已由 referencedObjectId 排除）。v1 不盘扫。 */
export function countSessionReferences(ctxThread: ThreadContext, targetId: string): number {
  let n = 0;
  for (const t of reachableThreads(ctxThread).values()) {
    if (!ACTIVE_STATUS.has(t.status)) continue;
    for (const w of t.contextWindows ?? []) if (referencedObjectId(w as any) === targetId) n++;
  }
  return n;
}
```

- [ ] **Step 4：绿。Step 5：commit** `feat(lifecycle): countSessionReferences（内存树，排除 done/failed/canceled）`

### Task 1.3：`dispatchUnactiveIfZero`（单次泛型，fast-path）

**Files:** Modify `object-lifecycle.ts` + test

- [ ] **Step 1：失败测试**（隔离 registry）

```ts
import { dispatchUnactiveIfZero } from "../object-lifecycle.js";
import { createObjectRegistry } from "../object-registry.js";
test("refcount 0 + class 有 unactive → 钩子被调（经 ctx.targetId）", async () => {
  const reg = createObjectRegistry(); let got = "";
  reg.register("_builtin/agent/thread", { unactive: { description: "", exec: (ctx: any) => { got = ctx.targetId; } } } as any);
  const p: any = { id: "t_p", status: "running", contextWindows: [], childThreads: {} };
  await dispatchUnactiveIfZero(p, "t_c", "_builtin/agent/thread", reg);
  expect(got).toBe("t_c");
});
test("class 无 unactive → fast-path no-op", async () => {
  const reg = createObjectRegistry(); const p: any = { id: "t", status: "running", contextWindows: [], childThreads: {} };
  await dispatchUnactiveIfZero(p, "filesystem", "_builtin/filesystem", reg); expect(true).toBe(true);
});
test("unactive 返回 {delete:true} → 删 objectDir + 移除内存窗（合成 class，临时 world）", async () => {
  // 用临时 baseDir 建 objectDir 落个文件；合成 class 的 unactive 返回 {delete:true}。
  // 断言：dispatch 后 objectDir 已不存在，且 ctxThread.contextWindows 不再含引用 targetId 的窗。
  const reg = createObjectRegistry();
  reg.register("_test/gc", { unactive: { description: "", exec: () => ({ delete: true }) } } as any);
  // （fixture：mkdir objectDir({baseDir,sessionId,objectId:"o_gc"}) + 写 state.json）
  const p: any = { id: "t", status: "running", persistence: { baseDir: TMP, sessionId: "s1" }, contextWindows: [], childThreads: {} };
  await dispatchUnactiveIfZero(p, "o_gc", "_test/gc", reg);
  // expect(existsSync(objectDir({baseDir:TMP,sessionId:"s1",objectId:"o_gc"}))).toBe(false);
});
```

> 该测试让 delete 路径**有真实被测者**（合成 `_test/gc` class），非死槽——v1 无 builtin 返回 delete（thread 返回 `{}`）。

- [ ] **Step 2：FAIL。Step 3：实现**（泛型——无 thread import、无 THREAD_CLASS_ID）

```ts
import type { ObjectRegistry } from "./object-registry.js";
import type { LifecycleContext } from "../executable/contract.js";
import { objectDir, type FlowObjectRef } from "../persistable/common.js";
import { rm } from "node:fs/promises";
/** close 移窗后：targetId 的 session refcount 归零且 class 声明 unactive → 单次派发，body 自解析（含级联）。 */
export async function dispatchUnactiveIfZero(ctxThread: ThreadContext, targetId: string, targetClass: string, registry: ObjectRegistry): Promise<void> {
  const hook = registry.resolveUnactive(targetClass);
  if (!hook) return;                                            // fast-path：无 body → 不算 refcount
  if (countSessionReferences(ctxThread, targetId) > 0) return;
  const ctx: LifecycleContext = { thread: ctxThread, runtime: undefined as any, args: {}, targetId };
  const r = await hook.exec(ctx);
  if (r && (r as { delete?: boolean }).delete === true) await removeObjectFromSession(ctxThread, targetId, registry);
}

/** delete:true → 彻底从 session 移除 targetId：删持久化（自定义 persistable.delete? 优先，否则 objectDir 路径）+ 移除内存实例。 */
async function removeObjectFromSession(ctxThread: ThreadContext, targetId: string, registry: ObjectRegistry): Promise<void> {
  const p = ctxThread.persistence;
  if (!p) return;
  const ref: FlowObjectRef = { baseDir: p.baseDir, sessionId: p.sessionId, objectId: targetId };
  // 自定义 persistable 经其 delete? 自理（v1 暂无；phase-2 加 PersistableModule.delete?）；缺省删 objectDir。
  await rm(objectDir(ref), { recursive: true, force: true });
  // 内存：从持有处移除（v1 合成测试 = 顶层 ctxThread.contextWindows 过滤；thread-target 的 childThreads
  // 删除推 phase-2——thread 不返回 delete，故 v1 不需要）。
  ctxThread.contextWindows = (ctxThread.contextWindows ?? []).filter((w) => referencedObjectId(w as any) !== targetId);
}
```

- [ ] **Step 4：绿。Step 5：commit** `feat(lifecycle): dispatchUnactiveIfZero（单次泛型 fast-path）`

---

## Phase 2：close 原语（closable 守卫 + unactive 派发）

### Task 2.1：closable 守卫 + 移窗后派发

**Files:** Modify `core/executable/tools/close.ts`

- [ ] **Step 1：登记账本**：`tools.test.ts:99-112`（关 creator 现断言 ok）将反转为报错；`tools.test.ts:107-132` close 用例新增「关 fork 窗派发 unactive」。登记。
- [ ] **Step 2：守卫 + 派发**（`handleCloseTool` 取到 `existing = mgr.get(windowId)` 之后）

```ts
import { referencedObjectId, dispatchUnactiveIfZero } from "../../runtime/object-lifecycle.js";
// 取到 existing 后：
if (existing.closable === false) {
  return errorOutput(`[close] window ${windowId} 不可关闭（结构窗：thread 与 creator 的恒在通道）。`);
}
const target = referencedObjectId(existing);
const targetClass = existing.class;
await mgr.close(windowId);
thread.contextWindows = mgr.toData();          // 先同步，refcount 才看得到「窗已移除」
if (target) await dispatchUnactiveIfZero(thread, target, targetClass, registry);
return successOutput(`[close] window ${windowId} 已关闭。原因：${reason}`);
```

- [ ] **Step 3：commit** `feat(close): closable 守卫 + 移窗后按 refcount 派发 unactive`

---

## Phase 3：thread 迁移（construct 标记 + unactive 级联 + 删 close）

### Task 3.1：init 给 creator/self 结构窗标 `closable:false`

**Files:** Modify `core/thinkable/context/init.ts`

- [ ] **Step 1：** `initContextWindows` 建 creator/self 窗的 instance 处，设 `closable: false`（结构窗、恒在通道）。fork 子窗、peer 窗、成员窗保持缺省（可关）。
- [ ] **Step 2：** grep 确认 creator 窗经此唯一路径创建（`threadWindowIdOf`）；冷恢复路径（`thread-persist.ts` 的 `initContextWindows` 兜底）同享此标记。
- [ ] **Step 3：commit** `feat(thread-init): creator/self 结构窗标 closable:false（construct 环节）`

### Task 3.2：thread `unactive` body（canceled + 级联子树）

**Files:** Modify `thread/index.ts:181-186`（+ 可在 `talk-fork.ts` 加 helper）

- [ ] **Step 1：加 Class.unactive**（cancelSubtree：切 canceled + 遍历子线程窗递归停用，per-call visited）

```ts
import type { ObjectLifecycleHook } from "@ooc/core/executable/contract.js";
import { findChild } from "@ooc/builtins/agent/thread/executable/talk-fork.js";
import { referencedObjectId, countSessionReferences } from "@ooc/core/runtime/object-lifecycle.js";
import type { ThreadContext as TC } from "@ooc/core/thinkable/context.js";

const TERMINAL = new Set(["done", "failed", "canceled"]);

function cancelSubtree(scope: TC, targetId: string, visited: Set<string>): void {
  if (visited.has(targetId)) return;
  const t = findChild(scope, targetId);
  if (!t || TERMINAL.has(t.status)) return;
  t.status = "canceled";                       // 停用 = 切终态 canceled（spec §2.2）
  visited.add(targetId);
  // 级联：t 切 canceled 后其窗不再计数 → 只被 t 引用的孙线程归 0 → 递归停用。
  for (const w of t.contextWindows ?? []) {
    const child = referencedObjectId(w as any);
    if (child && !visited.has(child) && countSessionReferences(t, child) === 0) cancelSubtree(t, child, visited);
  }
}

const unactive: ObjectLifecycleHook = {
  description: "Cancel the dereferenced (fork) thread and its now-unreferenced subtree. Identity persists.",
  exec: (ctx) => cancelSubtree(ctx.thread as TC, ctx.targetId, new Set<string>()),
};

export const Class: OocClass<Data> = { construct: talkConstructor, executable, readable, persistable, unactive };
```

> `thread.unactive` 返回 **void（= 不 delete）**——canceled 线程保留在盘上（同 done/failed，refinement-1），不删持久化。`{delete:true}` 是给将来需要彻底 GC 的对象类型用的（v1 无）。持久化沿用既有线程 save（worker tick；旧 archiveForkChild 也只置 status）。级联在 thread builtin（policy），core dispatcher 保持单次泛型。

- [ ] **Step 2：commit** `feat(thread): Class.unactive = cancel 子线程 + 级联子树（canceled）`

### Task 3.3：删 `closeMethod`，readable 去 close，处理 `archiveForkChild`

**Files:** `session-methods.ts`、`readable/index.ts:99`、`executable/index.ts`、`talk-fork.ts:71`

- [ ] **Step 1：登记账本** `grep -rln "close\|archiveForkChild" packages/@ooc/builtins/agent/children/thread/__tests__`
- [ ] **Step 2：** `session-methods.ts` 删 `closeMethod` + 仅其用 import；`sessionMethods=[sayMethod];`。
- [ ] **Step 3：** `readable/index.ts:99` `["say","close"]` → `["say"]`。
- [ ] **Step 4：** `archiveForkChild`：grep 其它调用方；cancelSubtree 已内联 findChild+置状态、不调它 → 若无其它调用方则删（退潮）。
- [ ] **Step 5：** `grep -rn "closeMethod\|\"close\"" packages/@ooc/builtins/agent/children/thread --include="*.ts" | grep -v __tests__` → 空。
- [ ] **Step 6：commit** `refactor(thread): 删 close 方法 + readable talk 去 close（+ 退役 archiveForkChild）`

---

## Phase 4：`canceled` 终态 consumer 扫描

### Task 4.1：把 canceled 同 done/failed 当终态/不可运行

**Files:** `worker.ts`、scheduler、`flows/service.ts` 等（实现期 grep 全扫）

- [ ] **Step 1：grep 全部 ThreadStatus 终态判定** `grep -rn '"done"\|"failed"' packages/@ooc/core --include="*.ts" | grep -v __tests__`，逐处判断是否应纳入 canceled：
  - `worker.ts:298` `callee.status !== "done" && callee.status !== "failed"` → 补 `&& !== "canceled"`（canceled callee 同终态、不再回报）。
  - scheduler / worker 选取可运行线程处：确保 canceled 不被调度（canceled ∉ runnable）。
  - `flows/model.ts`/UI：canceled 显示为已结束。
  - `thread-query.ts:37` 仅列 running/waiting → 天然排除，无需改。
- [ ] **Step 2：登记/修改**：能不破坏现源码连贯的直接改；大改登记账本留 Phase 5。
- [ ] **Step 3：commit** `feat(thread): canceled 终态接入 consumer（worker 同步/调度/UI）`

---

## Phase 5：测试账本统一修 + 全绿 gate

### Task 5.1：characterization + 新行为测试 + 门禁

- [ ] **Step 1：characterization（删 closeMethod 前的当前行为基线）**：构造 parent + fork child（内存树），断言**当前**「关 fork 窗 → child 状态变化」。删 closeMethod 后此测试改断言新行为（child = `canceled`）。
- [ ] **Step 2：核心新测试**
  - 关 fork 窗 → child `canceled`（非 paused）。
  - 嵌套 fork：parent→child→grandchild；关 parent→child 窗 → child 与 grandchild **都 canceled**（级联）。
  - 自引用不计：child 自带 self 窗（`threadWindowIdOf`）时，关父 fork 窗后 child 仍归 0 → canceled。
  - `close` 关 creator/self 结构窗（`closable:false`）→ **错误提示、不关**。
- [ ] **Step 3：改 `tools.test.ts:99-112`**：创建 thread 后 creator 窗 `closable:false`，关之断言 `ok===false` + 错误文案（**有意反转**旧「creator 可关」，spec §5.5）。
- [ ] **Step 4：全门禁**

```bash
bun run test:storybook
bun test packages/@ooc/builtins/agent/children/thread
bun test packages/@ooc/core/persistable packages/@ooc/core/runtime packages/@ooc/core/executable
```
Expected: 0 FAIL。

- [ ] **Step 5：e2e fork-cancel 跨 reload**：fork → 父关 fork 窗 → 子 canceled → reload → 子仍 canceled（不被复活/调度）。
- [ ] **Step 6：** `rm WAVE-LIFECYCLE-broken-tests.md`。**Step 7：commit** `test(lifecycle): canceled + 级联 + closable + 跨 reload e2e；全门禁绿`

---

## Phase 6：文档回流

### Task 6.1：thread.md §3 + close.ts 头注（agent-facing 行为口吻）

**Files:** `thread.md:35`、`close.ts:8-9`

- [ ] **Step 1：thread.md §3**（行为口吻、不写机制词）：close 是原语、移除一个引用；关一个 fork 子线程窗会使该子线程**取消（canceled）**、其子树一并取消，身份留存；creator/结构窗不可关，close 之报错；`end` 仍归 agent。
- [ ] **Step 2：close.ts:8-9** 头注：改指向 class `unactive` 钩子（refcount 归 0 触发）+ `closable` 标记。
- [ ] **Step 3：commit**（对象树仓单独 commit + push ooc-0）

### Task 6.2：object self.md 生命周期核心项（草案已落，待 review）

- [x] **Step 1：落核心 10 草案**（2026-06-21 已写入 `children/object/self.md` 核心区，标「新增待 review 后定字」）：「对象有生命周期：construct 诞生 → active/unactive 按引用计数停启 → 无 destruct；context window 即引用；close 移除一个引用；construct 可标结构窗不可关。」
- [ ] **Step 2：用户 review 通过后定字** → 去掉「待 review」标记 → 对象树 commit + push ooc-0（**当前未 commit/push，待 review**）。

### Task 6.3：相邻权威对账 + 退役扫描

- [ ] **Step 1：** `context.md:139`「关窗清理钩子」↔ unactive 对账；`context.md:193` core-11「thread 终止钩子」↔ phase-2 ③ 交叉引用合并。
- [ ] **Step 2：** `readable/self.md:84` 退役表加 `destruct`/`ObjectDestructor`。
- [ ] **Step 3：** `check:doc-drift` FORBIDDEN_PATTERNS 加 `ObjectDestructor`/`\.destruct\b`/thread `closeMethod`/readable talk `object_methods.*close`/`archiveForkChild`。
- [ ] **Step 4：** `bun run verify` 绿。**Step 5：commit** `chore(verify)+docs: 相邻权威对账 + 退役符号入扫描`

---

## 自审（spec 覆盖 / 占位 / 类型一致）

**Spec 覆盖：** §2 模型→Phase 0+3；§2.1 自引用→1.1；§2.2 canceled+级联→0.3(status)+1.2(排除)+3.2(cancelSubtree)；§3.1 fork-only→1.1；§3.2 内存树→1.2；§3.3 单次泛型+级联在 builtin→1.3+3.2；§3.4 fork-only→1.1；§4 改动面→Phase 0-4；§5 closable construct 标记+原语 honor→0.2(字段)+3.1(标记)+2.1(守卫)+5.3(反转测试)；§6 active 仅槽→0.2；§7 R-canceled→Phase 4、R-cascade visited→3.2、R-merge→0.4、R-sibling→3.3 Step4；§8 boundary→1.3(泛型)+3.2(policy)；§9 回流→Phase 6。**无遗漏。**

**占位扫描：** 无 TBD/TODO。「待定」= 6.2 object self.md（须听写）+「实现期核」标注（selfThenChain 名/sibling close grep/canceled consumer 全扫/fixture 适配）——故意要求核验真实代码。

**类型一致：** `ObjectLifecycleHook.exec(ctx:LifecycleContext) => void|UnactiveResult`（0.1）↔ `active?/unactive?`（0.2）↔ `resolveActive/resolveUnactive`（0.4）↔ `dispatchUnactiveIfZero` 调 `hook.exec(...)` 并据 `r.delete` 调 `removeObjectFromSession`（1.3）↔ thread `unactive.exec(ctx)`→`cancelSubtree`（返回 void=不 delete，3.2）—— 一致。`UnactiveResult{delete?}`（0.1）↔ dispatch honor（1.3）↔ thread 不用（3.2）。`ThreadStatus` 含 canceled（0.3）↔ `ACTIVE_STATUS` 排除（1.2）↔ `TERMINAL` 含（3.2）↔ consumer（Phase 4）一致。`OocObjectInstance.closable`（0.2）↔ init 标记（3.1）↔ close 守卫（2.1）一致。**无 `_ref`/diskScan/inFlight/THREAD_CLASS_ID 分支/active dispatch。**

## 已知未决（交回用户）
- **D1**：已确认 yes（2026-06-21）——`failed` 同 `done`/`canceled` 排除，`ACTIVE_STATUS={running,waiting,paused}`（1.2）。
- **R5**：object self.md 已落核心 10 草案（待用户 review；review 通过后随对象树 commit+push ooc-0）。
- **phase-2**：session 盘扫 / 成员对象 unactive / peer 跨对象 canceled（合 context.md core-11）/ active 派发 / `PersistableModule.delete?`（自定义持久化布局的删除；v1 删 objectDir 路径）/ thread-target 的 delete（childThreads 内存移除；v1 thread 不 delete）。
