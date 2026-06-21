/**
 * object-lifecycle —— core 泛型对象生命周期：引用计数 + unactive 派发。
 *
 * 设计权威：`docs/2026-06-21-object-activation-lifecycle-design.md`（spec §3）+
 * `.ooc-world-meta/.../children/object/self.md`（对象生命周期核心）。
 *
 * `ContextWindow` 是对 object 的引用；`close` 移除一个引用；引用计数清空触发可选的 `unactive`。
 * 本模块**泛型、零 thread builtin import**——只 import core 内部类型/谓词；级联/canceled 等
 * thread-specific policy 活在 thread builtin 的 unactive body。
 */
import type { OocObjectInstance } from "./ooc-class.js";
import type { ThreadContext } from "../_shared/types/thread.js";
import type { ObjectRegistry } from "./object-registry.js";
import type { LifecycleContext } from "../executable/contract.js";
import { isSelfThreadWindow } from "../_shared/types/context-window.js";
import { isTalkLikeClass } from "../_shared/types/constants.js";
import { objectDir, type FlowObjectRef } from "../persistable/common.js";
import { rm } from "node:fs/promises";

/** refcount 活动态：退出态 done/failed/canceled 排除（spec §2.2/§3.2，D1 confirmed）。 */
const ACTIVE_STATUS = new Set(["running", "waiting", "paused"]);

/**
 * 窗 → 它引用、且生命周期由本窗持有的对象 id。v1 仅 fork（其余 undefined）。
 *
 * 内存 `OocObjectInstance` **无** `_ref`/`refObjectId`（那只活在磁盘 thread-context.json entry，
 * hydrate 时丢弃）。故 v1 只解析 fork 子线程窗：talk-like class + isForkWindow + targetThreadId
 * 且非自己的 self 门面窗（self/creator 窗自引用不计数，spec §2.1）。peer 跨对象 / 独立成员 /
 * root 一律返回 undefined（v1 不派发，spec §3.1/§3.4）。
 */
export function referencedObjectId(w: OocObjectInstance): string | undefined {
  if (isTalkLikeClass(w.class)) {
    const d = (w.data ?? {}) as { isForkWindow?: boolean; targetThreadId?: string };
    if (d.isForkWindow && d.targetThreadId && !isSelfThreadWindow(w.id)) {
      return d.targetThreadId;
    }
  }
  return undefined;
}

/**
 * 从 start 沿 `_parentThreadRef` 到根、再 down 各 `childThreads` 收集 session 内存线程树（按 id 去重）。
 * v1 不盘扫（fork driver 全程在内存树内）；session 全范围盘扫推 phase-2。
 */
function reachableThreads(start: ThreadContext): Map<string, ThreadContext> {
  const out = new Map<string, ThreadContext>();
  const down = (t: ThreadContext): void => {
    if (!t || out.has(t.id)) return;
    out.set(t.id, t);
    for (const c of Object.values(t.childThreads ?? {})) down(c as ThreadContext);
  };
  let root = start;
  while ((root as { _parentThreadRef?: ThreadContext })._parentThreadRef) {
    root = (root as { _parentThreadRef?: ThreadContext })._parentThreadRef as ThreadContext;
  }
  down(root);
  return out;
}

/**
 * session 内存树非退出态线程中，外部引用 targetId 的窗数（自引用已由 referencedObjectId 排除）。
 * 退出态 {done, failed, canceled} 的线程持有的窗不计数（spec §2.2/§3.2）。v1 不盘扫。
 */
export function countSessionReferences(ctxThread: ThreadContext, targetId: string): number {
  let n = 0;
  for (const t of reachableThreads(ctxThread).values()) {
    if (!ACTIVE_STATUS.has(t.status)) continue;
    for (const w of t.contextWindows ?? []) {
      if (referencedObjectId(w) === targetId) n++;
    }
  }
  return n;
}

/**
 * close 移窗后：targetId 的 session refcount 归零且其 class 声明 unactive → 单次泛型派发，
 * body 自解析目标（含级联，是 builtin policy）。
 *
 * 1. `resolveUnactive` 无声明 → return（fast-path：refcount 成本只在被解引用对象 class 真声明 unactive 时付）。
 * 2. `countSessionReferences > 0` → return（仍被引用，未归零）。
 * 3. 单次 `hook.exec({thread, targetId, ...})`；core **不** import 任何 thread 符号、不 special-case class。
 * 4. 若返回 `{delete:true}` → core 把 targetId 彻底从 session 移除（含持久化文件）。仅 unactive honor delete。
 */
export async function dispatchUnactiveIfZero(
  ctxThread: ThreadContext,
  targetId: string,
  targetClass: string,
  registry: ObjectRegistry,
): Promise<void> {
  const hook = registry.resolveUnactive(targetClass);
  if (!hook) return; // fast-path：无 body → 不算 refcount
  if (countSessionReferences(ctxThread, targetId) > 0) return;
  const ctx: LifecycleContext = {
    thread: ctxThread,
    runtime: undefined,
    args: {},
    targetId,
  };
  const r = await hook.exec(ctx);
  if (r && (r as { delete?: boolean }).delete === true) {
    await removeObjectFromSession(ctxThread, targetId);
  }
}

/**
 * open/instantiate 加窗后：被引用对象 targetId 的 session refcount 由 0 变 1（刚加的窗 = 第一个
 * 外部引用）且其 class 声明 active → 单次泛型派发 active 钩子（与 unactive 对称、construct 之后
 * 首次激活也触发，spec §2）。
 *
 * v1 seam = `WindowManager.instantiate`（fork 窗在此诞生，是 referencedObjectId v1 唯一解析的窗）。
 * **扩展点**：phase-2 把 referencedObjectId 扩到 member/peer 窗时，init 注入路径
 * （initContextWindows / injectMember/PeerWindows，不经 instantiate）也须补本调用，否则对
 * init 注入的引用永不 fire active。active 不消费返回值（{delete} 仅 unactive honor）。
 */
export async function dispatchActiveIfFirst(
  ctxThread: ThreadContext,
  targetId: string,
  targetClass: string,
  registry: ObjectRegistry,
): Promise<void> {
  const hook = registry.resolveActive(targetClass);
  if (!hook) return; // fast-path：无 active body → 不算 refcount（零成本）
  if (countSessionReferences(ctxThread, targetId) !== 1) return; // 刚加的窗 = 第 1 个引用 ⇒ 0→1
  const ctx: LifecycleContext = {
    thread: ctxThread,
    runtime: undefined,
    args: {},
    targetId,
  };
  await hook.exec(ctx);
}

/**
 * delete:true → 彻底从 session 移除 targetId：删持久化（缺省删 objectDir 路径；自定义 persistable
 * 布局的删除推 phase-2 经 `PersistableModule.delete?`）+ 从内存持有处移除（v1 = 顶层
 * ctxThread.contextWindows 过滤掉引用 targetId 的窗；thread-target 的 childThreads 内存移除推
 * phase-2——thread 不返回 delete，故 v1 不需要）。
 */
async function removeObjectFromSession(
  ctxThread: ThreadContext,
  targetId: string,
): Promise<void> {
  const p = ctxThread.persistence;
  if (p) {
    const ref: FlowObjectRef = {
      baseDir: p.baseDir,
      sessionId: p.sessionId,
      objectId: targetId,
    };
    await rm(objectDir(ref), { recursive: true, force: true });
  }
  ctxThread.contextWindows = (ctxThread.contextWindows ?? []).filter(
    (w) => referencedObjectId(w) !== targetId,
  );
}
