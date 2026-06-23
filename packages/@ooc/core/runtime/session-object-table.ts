/**
 * session-object-table —— B→A：一个 session（= 内存线程树）内 `objectId → 唯一一个持 data 的
 * ooc 对象实例`（`OocObjectInstance`，identity map）。**context window（`OocObjectRef`）只是对它的
 * 引用**——窗持 `id`(=objectId)+缓存 class+视角态、**不持 data**；data 的唯一内存归宿是本表。
 *
 * 设计权威：`.ooc-world-meta/.../docs/issues/2026-06-21-object-contextwindow-split.md`
 * （裁决修正：OocObjectInstance=对象 / OocObjectRef=窗）+ `children/object/self.md`（对象模型核心 4）。
 *
 * 边界：
 * - **owner = session 级（job 执行上下文）**：表挂内存线程树的**根** thread（`_parentThreadRef` 走到顶），
 *   随 job 执行而在、随根 thread GC 而释放——**非永生全局表**（worker 各 job 独立 readThread 重建内存树，
 *   跨 job 物理隔离、无共享内存、无需锁）。
 * - **运行态、不持久化**：磁盘真相在各 object（独立对象 `data.json` / inline 对象随 thread-context）；
 *   本表是 hydrate 出的运行态镜像。窗写盘走 ref + 边界重组（见 thread-persist：persist 合 ref+表 data、
 *   hydrate 拆成 窗(ref) + 表(object)）。
 */
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import type { OocObjectInstance, OocObjectRef } from "./ooc-class.js";

/** 走 `_parentThreadRef` 到内存线程树根（session 作用域的锚）。 */
function rootOf(thread: ThreadContext): ThreadContext {
  let root = thread;
  while ((root as { _parentThreadRef?: ThreadContext })._parentThreadRef) {
    root = (root as { _parentThreadRef?: ThreadContext })._parentThreadRef as ThreadContext;
  }
  return root;
}

/** 取（惰性建）本 session 的对象表（挂根 thread，运行态、不持久化）。 */
export function getSessionObjectTable(thread: ThreadContext): Map<string, OocObjectInstance> {
  const root = rootOf(thread) as ThreadContext & {
    _objectTable?: Map<string, OocObjectInstance>;
  };
  // instanceof Map 守卫：若旧 thread.json 误持久化过 _objectTable（Map→JSON 成 {}）、reload 回来是
  // 普通对象，重建为 Map（防 `.set is not a function`）。新写盘已 strip 它，此为前向兼容兜底。
  if (!(root._objectTable instanceof Map)) root._objectTable = new Map();
  return root._objectTable;
}

/** 登记/更新一个对象实例到 session 对象表（按 instance.id 键；hydrate / instantiate 调用）。 */
export function setSessionObject(thread: ThreadContext, instance: OocObjectInstance): void {
  getSessionObjectTable(thread).set(instance.id, instance);
}

/** 按 objectId 取对象实例（dispatch / 渲染 / objectDataOf 解析）。 */
export function getSessionObject(
  thread: ThreadContext,
  objectId: string,
): OocObjectInstance | undefined {
  return getSessionObjectTable(thread).get(objectId);
}

/** object 彻底移除（lifecycle delete:true / 末-ref-evict）→ 从对象表删表项，杜绝悬空引用。 */
export function evictObjectFromTable(thread: ThreadContext, objectId: string): void {
  getSessionObjectTable(thread).delete(objectId);
}

/**
 * 构造一个 context window 并把它引用的 object 登记进 session 对象表（窗=ref / data 入表，一处搞定）。
 *
 * 给「以前一次性构造 `{id, class, data, ...视角态}` 整窗」的站点用：传 `{id, class, data, ...视角态}`，
 * 它把 `{id, class, data}` 写入对象表、返回纯 ref（`{id, class, ...视角态}`，不含 data）。
 * 调用方拿返回值 push 进 contextWindows。
 */
export function materializeWindow(
  thread: ThreadContext,
  spec: { id: string; class: string; data: unknown } & Omit<OocObjectRef, "id" | "class">,
): OocObjectRef {
  const { data, ...ref } = spec;
  setSessionObject(thread, { id: spec.id, class: spec.class, data });
  return ref as OocObjectRef;
}
