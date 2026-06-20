# 对象激活生命周期（unactive 经 refcount）实现 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐 task 实现。步骤用 `- [ ]` 跟踪。
> **配套 spec**：`docs/2026-06-21-object-activation-lifecycle-design.md`（读它建立模型；本 plan 不复述设计理由）。
> **本 plan 已过 4-lens 对抗 review 并按其 P0/P1 瘦身**（见 spec §10）；实现前注意 spec §5 的用户决策点（closable 默认不加）。

**Goal:** 把 thread 的 `close` 方法塌回纯原语，引入可选 `unactive` 对象生命周期钩子——core 在 session（内存树）refcount 归 0 时**泛型**派发；thread 用 `unactive` 接管「关 fork 窗 → pause 子线程」。`active?` 仅作类型槽声明（v1 不接派发）。

**Architecture:** core 提供**泛型**机制（refcount + dispatch，复用 dead `destruct?` 槽，零 thread import），builtin 提供钩子 body（v1 仅 thread）。与 `construct` dispatch（`WindowManager.instantiate` 纯泛型）同构。refcount 当场算、内存树 only、无持久索引；**仅当被解引用对象 class 真声明 unactive 时才算 refcount**（fast-path，成本钉在 fork-close）。

**Tech Stack:** TypeScript / bun runtime；`bun:test`；既有 `WindowManager`/`ObjectRegistry`/`findChild`。

**测试策略（用户大重构工作模式 `feedback_refactor_defer_test_fixes`）：**
- 净新增模块（Phase 1 `object-lifecycle.ts`）走 **TDD-green**。
- 跨切源码改动（Phase 0 契约改名 / Phase 4 删 close 方法）**保持源码连贯可运行**，受影响旧测试**登记 `WAVE-LIFECYCLE-broken-tests.md`、不逐步修**；Phase 5 统一修 + 全量跑绿。
- 每 Phase 末 commit；Phase 5 末是唯一「全绿」gate。

**全局门禁（Phase 5 末全绿）：** `bun run test:storybook`；`bun test packages/@ooc/builtins/agent/children/thread`；`bun test packages/@ooc/core/{persistable,runtime,executable}`；e2e fork-pause 跨 reload。

---

## 文件结构（已锁，对抗 review 后）

**新建：**
- `packages/@ooc/core/runtime/object-lifecycle.ts` —— 唯一新模块：`referencedObjectId`（fork-only）+ `countSessionReferences`（内存树）+ `dispatchUnactiveIfZero`（泛型）。**零 thread import。**
- `packages/@ooc/core/runtime/__tests__/object-lifecycle.test.ts`
- `WAVE-LIFECYCLE-broken-tests.md`（仓库根，临时账本，Phase 5 删）

**修改：**
- `packages/@ooc/core/executable/contract.ts:184-195` —— 删 `ObjectDestructor`，加 `ObjectLifecycleHook` + `LifecycleContext`。
- `packages/@ooc/core/runtime/ooc-class.ts:17,35,49` —— `destruct?` → `active?`(仅声明) + `unactive?`。
- `packages/@ooc/core/runtime/object-registry.ts:117-165` —— 加 `resolveActive`/`resolveUnactive`（`selfThenChain`）+ merge 块补 active/unactive 保留。
- `packages/@ooc/core/executable/tools/close.ts` —— 移除窗后派发 unactive。**不加 closable 守卫。**
- `packages/@ooc/builtins/agent/children/thread/index.ts:181-186` —— `Class` 加 `unactive`。
- `packages/@ooc/builtins/agent/children/thread/executable/session-methods.ts` —— 删 `closeMethod`，`sessionMethods=[sayMethod]`。
- `packages/@ooc/builtins/agent/children/thread/readable/index.ts:99` —— `talk` 投影 `object_methods:["say"]`。
- `packages/@ooc/builtins/agent/children/thread/executable/talk-fork.ts:71` —— `archiveForkChild` 逻辑并入 unactive（或保留供调用）。

**v1 不做（推 phase-2，spec §6）：** `active` 派发；session 盘扫；`_ref` 成员 unactive；closable 守卫；重入守卫。

---

## Phase 0：契约 + OocClass + registry

### Task 0.1：契约 —— `ObjectDestructor` → `ObjectLifecycleHook` + `LifecycleContext`

**Files:** Modify `packages/@ooc/core/executable/contract.ts:184-195`

- [ ] **Step 1：替换接口**（删 `ObjectDestructor` 行 184-195，换为）

```ts
/**
 * 生命周期钩子上下文 —— 作用于既有对象（非构造），故带 targetId。
 * ctx.thread = 解引用发生处的线程；targetId = refcount 变动的对象 id；runtime 句柄可选。
 */
export interface LifecycleContext extends ConstructorContext {
  /** refcount 跨 0↔1 的对象 id（钩子 body 据此定位自己要操作的对象）。 */
  targetId: string;
}

/**
 * 对象生命周期钩子（active / unactive 共用）—— 与 construct 对称、按 refcount 0↔1 触发。
 *
 * 注意：与 construct **签名不同**——construct 产出新 Data，本钩子作用于既有对象、不产 Data。
 * body 经 ctx（thread + targetId）自解析要操作的对象。皆可选；不声明则无生命周期副作用。
 * 没有 destruct —— OOC object 是持久身份，unactive 只释放运行时资源、磁盘身份留存。
 */
export interface ObjectLifecycleHook {
  description: string;
  exec: (ctx: LifecycleContext) => void | Promise<void>;
}
```

- [ ] **Step 2：grep 旧符号**

Run: `grep -rn "ObjectDestructor\|\.destruct\b" packages/@ooc --include="*.ts" | grep -v __tests__`
Expected: 仅 `ooc-class.ts` 命中（Task 0.2）；其余登记账本。

- [ ] **Step 3：commit** `refactor(executable): ObjectDestructor → ObjectLifecycleHook + LifecycleContext`

### Task 0.2：OocClass 槽

**Files:** Modify `packages/@ooc/core/runtime/ooc-class.ts:17,35,49`

- [ ] **Step 1**：行 17 import `ObjectDestructor` → `ObjectLifecycleHook`；行 35 注释改 `- active/unactive : refcount 0↔1 触发的生命周期（与 construct 对应；皆可选）`；行 49 `destruct?: ObjectDestructor<Data>;` →

```ts
  /** v1 仅声明类型槽，dispatch 待首个 active body（spec §6）。 */
  active?: ObjectLifecycleHook;
  unactive?: ObjectLifecycleHook;
```

- [ ] **Step 2：编译自检** `bunx tsc --noEmit -p packages/@ooc/core 2>&1 | grep ooc-class` → Expected: 无错。
- [ ] **Step 3：commit** `refactor(runtime): OocClass.destruct? → active?/unactive? 生命周期槽`

### Task 0.3：registry `resolveActive`/`resolveUnactive` + merge 保留

**Files:** Modify `packages/@ooc/core/runtime/object-registry.ts`

- [ ] **Step 1：照 `resolveConstructor` 加两解析器**（核实：`selfThenChain(classId)` 返回 class-id **链数组**，非回调；`resolveConstructor` 是 for 循环——object-registry.ts:159-165。**勿用 `getClass`——它单 store 查、不走继承链**）

在 `resolveConstructor`（159-165）旁，**同款 for 循环**：

```ts
resolveActive(classId: string): ObjectLifecycleHook | undefined {
  for (const cid of this.selfThenChain(classId)) {
    const h = this.store.get(cid)?.active;
    if (h) return h;
  }
  return undefined;
}
resolveUnactive(classId: string): ObjectLifecycleHook | undefined {
  for (const cid of this.selfThenChain(classId)) {
    const h = this.store.get(cid)?.unactive;
    if (h) return h;
  }
  return undefined;
}
```

> import `ObjectLifecycleHook` 类型。`selfThenChain` 私有（类内调用 OK）。

- [ ] **Step 2：merge 块补保留**（`object-registry.ts:117-121` register 合并，现显式保 construct/executable/readable/persistable/parentClass）。加两行，防增量 re-register 经 `...cls` 把已注册钩子覆盖丢：

```ts
      active: cls.active ?? existing?.active,
      unactive: cls.unactive ?? existing?.unactive,
```

- [ ] **Step 3：编译自检** `bunx tsc --noEmit -p packages/@ooc/core 2>&1 | grep object-registry` → Expected: 无错。
- [ ] **Step 4：commit** `feat(runtime): registry.resolveActive/resolveUnactive（selfThenChain）+ merge 保留生命周期槽`

---

## Phase 1：`object-lifecycle.ts`（TDD-green，泛型，零 thread import）

### Task 1.1：`referencedObjectId`（fork-only）

**Files:** Create `object-lifecycle.ts` + `__tests__/object-lifecycle.test.ts`

- [ ] **Step 1：写失败测试**（用真实 `OocObjectInstance` 形状——**无 `_ref` 字段**）

```ts
import { test, expect } from "bun:test";
import { referencedObjectId } from "../object-lifecycle.js";
import { threadWindowIdOf } from "../../_shared/types/context-window.js";

test("fork 窗 → targetThreadId", () => {
  const w = { id: "w1", class: "_builtin/agent/thread", status: "open", data: { isForkWindow: true, targetThreadId: "t_child" } } as any;
  expect(referencedObjectId(w)).toBe("t_child");
});
test("self 门面窗 → undefined（自引用不计）", () => {
  const w = { id: threadWindowIdOf("t_self"), class: "_builtin/agent/thread", status: "open", data: { isForkWindow: true, targetThreadId: "t_self" } } as any;
  expect(referencedObjectId(w)).toBeUndefined();
});
test("peer 跨对象会话窗 → undefined（v1 不派发）", () => {
  const w = { id: "w_peer", class: "_builtin/agent/thread", status: "open", data: { target: "alice", targetThreadId: "t_alice" } } as any;
  expect(referencedObjectId(w)).toBeUndefined();
});
test("独立成员窗（filesystem）→ undefined（v1 不派发，phase-2）", () => {
  const w = { id: "filesystem", class: "_builtin/filesystem", status: "open", data: {} } as any;
  expect(referencedObjectId(w)).toBeUndefined();
});
```

- [ ] **Step 2：跑、FAIL。** `bun test packages/@ooc/core/runtime/__tests__/object-lifecycle.test.ts`
- [ ] **Step 3：实现**

```ts
// object-lifecycle.ts —— core 泛型对象生命周期：refcount + unactive 派发。零 thread builtin import。
import type { OocObjectInstance } from "./ooc-class.js";
import { isSelfThreadWindow } from "../_shared/types/context-window.js";
import { isTalkLikeClass } from "../_shared/types/constants.js";

/**
 * 窗 → 它引用、且其生命周期由本窗持有的对象 id。v1 仅 fork：
 * - fork 子线程窗（talk-like + data.isForkWindow + targetThreadId + 非 self 窗）→ targetThreadId。
 * - 其余（self/peer/独立成员/root）→ undefined（v1 不派发；spec §3.1）。
 * 注意：内存 OocObjectInstance 无 _ref/refObjectId（那是磁盘 entry 形状）——v1 不读它。
 */
export function referencedObjectId(w: OocObjectInstance): string | undefined {
  if (isTalkLikeClass(w.class)) {
    const d = (w.data ?? {}) as { isForkWindow?: boolean; targetThreadId?: string };
    if (d.isForkWindow && d.targetThreadId && !isSelfThreadWindow(w.id)) return d.targetThreadId;
  }
  return undefined;
}
```

- [ ] **Step 4：跑绿。** **Step 5：commit** `feat(lifecycle): referencedObjectId（v1 fork-only，对内存窗）`

### Task 1.2：`countSessionReferences`（内存树，非终态外部引用）

**Files:** Modify `object-lifecycle.ts` + test

- [ ] **Step 1：写失败测试**

```ts
import { countSessionReferences } from "../object-lifecycle.js";
function thr(id: string, status: string, windows: any[]) {
  return { id, status, contextWindows: windows, childThreads: {} } as any;
}
test("fork 子线程仅被父 fork 窗引用 → 1；父去窗 → 0", () => {
  const parent = thr("t_p", "running", [{ id: "w_fork", class: "_builtin/agent/thread", status: "open", data: { isForkWindow: true, targetThreadId: "t_child" } }]);
  expect(countSessionReferences(parent, "t_child")).toBe(1);
  parent.contextWindows = [];
  expect(countSessionReferences(parent, "t_child")).toBe(0);
});
test("done 线程的引用不计数", () => {
  const child = thr("t_c2", "done", [{ id: "w_f", class: "_builtin/agent/thread", status: "open", data: { isForkWindow: true, targetThreadId: "x" } }]);
  const parent = thr("t_p2", "running", []); parent.childThreads = { t_c2: child };
  expect(countSessionReferences(parent, "x")).toBe(0);
});
```

- [ ] **Step 2：FAIL。** **Step 3：实现**

```ts
import type { ThreadContext } from "../_shared/types/thread.js";

const ACTIVE_STATUS = new Set(["running", "waiting", "paused"]); // 终态 done/failed 排除（spec §3.2 / D1）

/** 内存树：当前线程 + 沿 _parentThreadRef 的根 + 各自 childThreads 递归，按 id 去重。 */
function reachableThreads(start: ThreadContext): Map<string, ThreadContext> {
  const out = new Map<string, ThreadContext>();
  const down = (t: ThreadContext) => {
    if (!t || out.has(t.id)) return;
    out.set(t.id, t);
    for (const c of Object.values(t.childThreads ?? {})) down(c as ThreadContext);
  };
  let root = start;
  while ((root as any)._parentThreadRef) root = (root as any)._parentThreadRef;
  down(root);
  return out;
}

/** session 内存树内非终态线程中，外部引用 targetId 的窗数（自引用已由 referencedObjectId 排除）。v1 不盘扫。 */
export function countSessionReferences(ctxThread: ThreadContext, targetId: string): number {
  let n = 0;
  for (const t of reachableThreads(ctxThread).values()) {
    if (!ACTIVE_STATUS.has(t.status)) continue;
    for (const w of t.contextWindows ?? []) if (referencedObjectId(w as any) === targetId) n++;
  }
  return n;
}
```

- [ ] **Step 4：跑绿。** **Step 5：commit** `feat(lifecycle): countSessionReferences（内存树，非终态外部引用）`

### Task 1.3：`dispatchUnactiveIfZero`（泛型，fast-path，body 自解析）

**Files:** Modify `object-lifecycle.ts` + test

- [ ] **Step 1：写失败测试**（用隔离 registry，避免单例污染）

```ts
import { dispatchUnactiveIfZero } from "../object-lifecycle.js";
import { createObjectRegistry } from "../object-registry.js";

test("关 fork 窗 → 子 refcount 0 → thread.unactive 经 ctx.targetId pause 子线程", async () => {
  const reg = createObjectRegistry();
  // 模拟 thread class 的 unactive：body 自解析（这里直接用 ctx 里现成的 child）
  const child: any = { id: "t_child", status: "running", contextWindows: [], childThreads: {} };
  const parent: any = { id: "t_parent", status: "running", contextWindows: [], childThreads: { t_child: child } };
  reg.register("_builtin/agent/thread", { unactive: { description: "", exec: (ctx: any) => {
    const c = ctx.thread.childThreads[ctx.targetId];
    if (c && (c.status === "running" || c.status === "waiting")) c.status = "paused";
  } } } as any);
  await dispatchUnactiveIfZero(parent, "t_child", "_builtin/agent/thread", reg);
  expect(child.status).toBe("paused");
});
test("class 无 unactive → fast-path no-op（不算 refcount）", async () => {
  const reg = createObjectRegistry();
  const parent: any = { id: "t_p", status: "running", contextWindows: [], childThreads: {} };
  await dispatchUnactiveIfZero(parent, "filesystem", "_builtin/filesystem", reg); // 不 throw
  expect(true).toBe(true);
});
```

- [ ] **Step 2：FAIL。** **Step 3：实现**（泛型——**无 thread import、无 THREAD_CLASS_ID 分支**）

```ts
import type { ObjectRegistry } from "./object-registry.js";
import type { LifecycleContext } from "../executable/contract.js";

/** close 移除窗后：若 targetId 的 session refcount 归零且其 class 声明 unactive，则派发。body 自解析目标。 */
export async function dispatchUnactiveIfZero(
  ctxThread: ThreadContext, targetId: string, targetClass: string, registry: ObjectRegistry,
): Promise<void> {
  const hook = registry.resolveUnactive(targetClass);
  if (!hook) return;                                        // fast-path：无 body → 不算 refcount
  if (countSessionReferences(ctxThread, targetId) > 0) return;
  const ctx: LifecycleContext = { thread: ctxThread, runtime: undefined as any, args: {}, targetId };
  await hook.exec(ctx);
}
```

> 设计要点（spec §3.3/§8）：core 不知道 target 是不是 thread；它把 `{thread, targetId}` 交给钩子，由 thread builtin 的 unactive body 用 `findChild` 自定位。core 泛型、零 thread import，与 construct dispatch 同构。

- [ ] **Step 4：跑绿。** **Step 5：commit** `feat(lifecycle): dispatchUnactiveIfZero（泛型 fast-path，body 经 ctx.targetId 自解析）`

---

## Phase 2：close 原语接 unactive 派发（不加 closable 守卫）

### Task 2.1：close 移除窗后派发 unactive

**Files:** Modify `packages/@ooc/core/executable/tools/close.ts`

> **spec §5 决策点**：默认 **不** 加 self/creator 窗 closable 守卫（保持 close 原语「关任何窗」的 Wave-4 退役后现状；`tools.test.ts:99` 证其为现行为）。若用户拍板方案 B 再单加，届时须改 `tools.test.ts:99-112`。

- [ ] **Step 1：登记账本**：`core/executable/__tests__/tools.test.ts` close 用例（行 107-132）行为新增「关 fork 窗副带派发 unactive」，登记 `WAVE-LIFECYCLE-broken-tests.md`。
- [ ] **Step 2：派发**（`handleCloseTool` 内，`mgr.close` 前捕获窗、后派发）

```ts
import { referencedObjectId, dispatchUnactiveIfZero } from "../../runtime/object-lifecycle.js";
// ... existing：取到 existing = mgr.get(windowId) 之后：
const closing = mgr.get(windowId)!;
const target = referencedObjectId(closing);
const targetClass = closing.class;
await mgr.close(windowId);
thread.contextWindows = mgr.toData();          // 先同步，refcount 才看得到「窗已移除」
if (target) await dispatchUnactiveIfZero(thread, target, targetClass, registry);
return successOutput(`[close] window ${windowId} 已关闭。原因：${reason}`);
```

> 级联子窗（`WindowManager.close` 递归）：v1 各级联窗多为 self/普通窗（`referencedObjectId`→undefined），不触发；级联到 fork 窗的 unactive 是已知 phase-2 缺口（spec §6）。

- [ ] **Step 3：commit** `feat(close): 移除窗后按 refcount 派发 unactive`

---

## Phase 3：thread 迁移（删 close 方法 → unactive 钩子）

### Task 3.1：thread `unactive` body

**Files:** Modify `packages/@ooc/builtins/agent/children/thread/index.ts:181-186`

- [ ] **Step 1：加 Class.unactive**（body 用 `findChild(ctx.thread, ctx.targetId)` 自定位子线程）

```ts
import type { ObjectLifecycleHook } from "@ooc/core/executable/contract.js";
import { findChild } from "@ooc/builtins/agent/thread/executable/talk-fork.js";

const unactive: ObjectLifecycleHook = {
  description: "Deactivate the dereferenced (fork child) thread: running/waiting → paused. Identity persists.",
  exec: (ctx) => {
    const child = findChild(ctx.thread!, ctx.targetId);
    if (child && (child.status === "running" || child.status === "waiting")) child.status = "paused";
  },
};

export const Class: OocClass<Data> = { construct: talkConstructor, executable, readable, persistable, unactive };
```

> 语义等价旧 `archiveForkChild`（running/waiting → paused），但路径不可绕过。持久化沿用既有线程 save（worker tick；旧 archiveForkChild 也只置 status）。

- [ ] **Step 2：commit** `feat(thread): Class.unactive = pause 被解引用的 fork 子线程（经 ctx.targetId）`

### Task 3.2：删 `closeMethod`，readable 去 close

**Files:** `session-methods.ts`、`readable/index.ts:99`、`executable/index.ts`

- [ ] **Step 1：登记账本**：grep thread 测试里 close 用例。Run: `grep -rln "close\|archiveForkChild" packages/@ooc/builtins/agent/children/thread/__tests__`（登记结果）
- [ ] **Step 2：删 closeMethod**：`session-methods.ts` 删整个 `closeMethod` + 仅其用的 import（`asTalkWindowView` 若仅 close 用则删）；`sessionMethods = [sayMethod];`。`executable/index.ts` 同步（若透传 sessionMethods 则无需改）。
- [ ] **Step 3：readable 去 close**：`readable/index.ts:99` `["say", "close"]` → `["say"]`。
- [ ] **Step 4：grep 零残留** `grep -rn "closeMethod\|\"close\"" packages/@ooc/builtins/agent/children/thread --include="*.ts" | grep -v __tests__` → Expected: 空。
- [ ] **Step 5：commit** `refactor(thread): 删 close 方法（塌回纯原语）+ readable talk 去 close；副作用归 unactive`

### Task 3.3：`archiveForkChild` 去留

**Files:** `talk-fork.ts:71`

- [ ] **Step 1：grep 其它调用方** `grep -rn "archiveForkChild" packages/@ooc --include="*.ts" | grep -v __tests__`
  - 若仅原定义（unactive 已内联 findChild+pause、不再调它）→ 删 `archiveForkChild`（退潮）。
  - 若有其它调用方 → 保留。
- [ ] **Step 2：commit**（如删）`refactor(thread): 删退役 archiveForkChild（unactive 直接 findChild+pause）`

---

## Phase 4：测试账本统一修 + 全绿 gate

### Task 4.1：characterization test 先行 + 账本修复

> **顺序要点（spec R2）**：删 closeMethod **前**已无 fork-pause 测试（grep 为空）。本 Phase 第一步先补当前行为 characterization test，让 Phase 3 重构是「验证等价」。若 subagent 流先做了 Phase 3，则此处补的是新行为测试——二者断言相同（关 fork 窗 → 子 paused），等价即可。

- [ ] **Step 1：新增 fork-unactive 集成测试**（取代「原 close-method 覆盖」——实为净新增）

```ts
// thread/__tests__/fork-unactive.test.ts（要点，按既有 fixture 适配）
// 构造 parent + fork child（in-mem tree）→ 经 close 原语关 fork 窗 → 断言 child.status === "paused"
// 再加：parent.childThreads 含 child 的真实 self 窗（threadWindowIdOf(childId)）时，refcount 仍 0（自引用不计）→ 仍 pause
```

- [ ] **Step 2：修 `tools.test.ts` close 用例**：close 仍是原语；新增断言「关 fork 窗 → dispatchUnactive 被触发/子 paused」。保留 `tools.test.ts:99`「关 creator 窗 ok」（方案 A：不变）。
- [ ] **Step 3：跑全量门禁**

```bash
bun run test:storybook
bun test packages/@ooc/builtins/agent/children/thread
bun test packages/@ooc/core/persistable packages/@ooc/core/runtime packages/@ooc/core/executable
```
Expected: 全 PASS（0 FAIL）。

- [ ] **Step 4：e2e fork-pause 跨 reload**：fork → 父 close fork 窗 → 子 paused → reload → 子仍 paused。
- [ ] **Step 5：删账本** `rm WAVE-LIFECYCLE-broken-tests.md`
- [ ] **Step 6：commit** `test(lifecycle): characterization + fork-unactive 集成 + 跨 reload e2e；全门禁绿`

---

## Phase 5：文档回流

### Task 5.1：thread.md §3 + close.ts 头注（agent-facing 行为口吻）

**Files:** `.ooc-world-meta/.../children/thinkable/knowledge/thread.md:35`、`core/executable/tools/close.ts:8-9`

- [ ] **Step 1：thread.md §3**（**行为口吻、不写机制词**）：close 是 tool 原语、作用于窗（移除一个引用）；关闭一个 fork 子线程窗会使该子线程暂停（paused），其身份留存可再被引用。`end` 仍归 agent（正交）。**不写** refcount/dispatch/unactive/closable（memory: agent-facing voice）。
- [ ] **Step 2：close.ts:8-9** 头注：删「如需 close 副作用，由对应 class 的方法层自理」，改「close 副作用经 class `unactive` 钩子（refcount 归 0 触发）」。
- [ ] **Step 3：commit**（对象树仓单独 commit + push ooc-0；core 改随父仓/分支）

### Task 5.2：object self.md 生命周期核心项（**待用户听写**）

**Files:** `.ooc-world-meta/.../children/object/self.md`

- [ ] **Step 1：拟稿（不直接定稿核心区）**：草案「**对象生命周期**：construct 产出身份（一次）；active/unactive 按 context window 引用计数 0↔1 触发（可选）；无 destruct——object 是持久身份，unactive 只释放运行时资源、磁盘身份留存。」
- [ ] **Step 2：标 R5**：核心 9 条听写锁定，本条须经用户听写/grill 定字 → 放 §四模拟推演待议区 / PR 描述，**不自落核心区**。

### Task 5.3：相邻权威对账 + 退役扫描

**Files:** `context.md:139,193`、`readable/self.md:84`、`check:doc-drift` FORBIDDEN_PATTERNS

- [ ] **Step 1：context.md:139**「关窗清理钩子」与新 unactive 对账（关窗清理现 = class unactive）。
- [ ] **Step 2：context.md:193** core-11「thread 终止钩子」与 spec phase-2 ③（thread→done 释放引用）交叉引用、注明合并方向（勿另起平行机制）。
- [ ] **Step 3：readable/self.md:84** 退役表加 `destruct`/`ObjectDestructor`（与 onClose 并列）。
- [ ] **Step 4：扫描**：`check:doc-drift`/`check-no-deprecated-symbols` 的 FORBIDDEN_PATTERNS 加 `ObjectDestructor`、`\.destruct\b`、thread `closeMethod`、readable talk `object_methods.*close`、`archiveForkChild`（若删）。
- [ ] **Step 5：`bun run verify`（含 check:doc-drift）绿。** **Step 6：commit** `chore(verify)+docs: 相邻权威对账 + 退役符号入漂移扫描`

---

## 自审（spec 覆盖 / 占位 / 类型一致）

**Spec 覆盖：** §2 模型→Phase 0+3；§2.1 自引用→Task 1.1（isSelfThreadWindow 排除）；§2.2 paused 计数→Task 1.2（ACTIVE_STATUS 含 paused）；§3.1 fork-only ref→1.1；§3.2 内存树 refcount→1.2；§3.3 泛型派发+fast-path→1.3；§3.4 intra-object→1.1（仅 fork）；§4 改动面→Phase 0-3；§5 closable 决策→Task 2.1（默认不加 + 决策注）；§6 分期（active 仅槽 / 盘扫 phase-2）→Task 0.2(仅声明)+无 Phase active；§7 R2 characterization→Task 4.1、R3 merge→0.3、R4 sibling→（spec 注，实现期 grep）；§8 boundary 正交→Task 1.3（泛型零 import）；§9 回流→Phase 5。**无遗漏。**

**占位扫描：** 无 TBD/TODO。唯一「待定」= Task 5.2 object self.md（须用户听写，非占位）+ 「实现期核」标注（`selfThenChain` 真名、sibling no-op close grep、fixture 适配）——**故意要求对真实代码核验**，非偷懒。

**类型一致：** `ObjectLifecycleHook.exec(ctx: LifecycleContext)`（0.1）↔ `active?/unactive?`（0.2）↔ `resolveActive/resolveUnactive`（0.3）↔ `dispatchUnactiveIfZero` 调 `hook.exec({thread,targetId,...})`（1.3）↔ thread `unactive.exec(ctx)` 读 `ctx.targetId`/`ctx.thread`（3.1）—— 全一致。`referencedObjectId`/`countSessionReferences`/`dispatchUnactiveIfZero` 跨 Phase 调用名一致。**无 `_ref`、无 diskScan、无 inFlight、无 THREAD_CLASS_ID 分支、无 active dispatch**（对抗 review 已砍）。

## 已知未决（交回用户）
- **spec §5 / P1-3**：closable 守卫——默认方案 A（不加，保持 creator 可关的 Wave-4 现状）；要方案 B（原语级禁关 self/creator）须用户拍板 + 改 tools.test.ts:99。
- **D1**：`failed` 线程是否同 `done` 排除（默认排除，Task 1.2 `ACTIVE_STATUS`）。
- **R5**：object self.md 生命周期核心项定字（Task 5.2，须听写）。
- **phase-2**：session 盘扫 / 成员对象 unactive / thread→done 释放引用（合 context.md core-11）/ active 派发 / 重入守卫。
