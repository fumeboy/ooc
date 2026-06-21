/**
 * session-object-table —— B→A：一个 session（= 内存线程树）内 `objectId → 唯一一个持 data 的
 * ooc 对象实例`（identity map）。ContextWindow 是对该对象的引用——磁盘上只持 `objectRef`，内存里
 * `window.object` 解析为**指向表项的共享引用**（非每窗私有副本）。
 *
 * 设计权威：`.ooc-world-meta/.../docs/issues/2026-06-21-object-contextwindow-split.md`
 * 「裁决修正 II（B→A）」+ `children/object/self.md`（对象模型核心：window=ref / 对象表=data residence）。
 *
 * 边界（reviewer fan-out 裁定）：
 * - **owner = session 级（job 执行上下文）**：表挂内存线程树的**根** thread（`_parentThreadRef` 走到顶），
 *   随 job 执行而在、随根 thread GC 而释放——**非永生全局表**（worker 各 job 独立 `readThread` 重建内存树，
 *   故跨 job 物理隔离、无共享内存、无需锁）。
 * - **作用域 = in-process 同 job fork 子树**：同一 objectId 的多窗（同树内）解析到同一 live instance、
 *   改即处处见（单 driver 串行、无竞争）。cross-job/session/object 仍走磁盘 last-writer-wins（A 不承诺 live）。
 * - **运行态、不持久化**：磁盘仍是真相（独立对象 `data.json` / inline 对象随 thread-context 整窗）；本表是其
 *   hydrate 出的运行态镜像/解析缓存。窗写盘仍走 `objectRef`（独立）/ 平铺 class+data（inline），见 thread-persist。
 *
 * 现状（诚实标注）：独立对象现「每次 open 铸新 id」、门面窗 data 为空，故跨窗**真实** data 共享当前稀有
 * （表多为 1:1）——本表先把「window=ref / 一 objectId 一 instance」的**结构与解析层**钉死，是后续「稳定/去重
 * objectId」让共享真正生效的地基。
 */
import type { ThreadContext } from "../_shared/types/thread.js";
import type { OocObjectInstance } from "./ooc-class.js";

/** 表项 = 一个 object 的身份 + data（被同 objectId 的多个 context window 共享引用）。 */
export type SessionObject = OocObjectInstance["object"];

/** 窗解析到的对象 id（= 该窗引用哪个对象的 data）：独立对象 `objectRef.objectId`、其余回落窗 id（1:1）。 */
export function objectKeyOf(w: OocObjectInstance): string {
  return w.objectRef?.objectId ?? w.id;
}

/** 走 `_parentThreadRef` 到内存线程树根（session 作用域的锚）。 */
function rootOf(thread: ThreadContext): ThreadContext {
  let root = thread;
  while ((root as { _parentThreadRef?: ThreadContext })._parentThreadRef) {
    root = (root as { _parentThreadRef?: ThreadContext })._parentThreadRef as ThreadContext;
  }
  return root;
}

/** 取（惰性建）本 session 的对象表（挂根 thread，运行态、不持久化）。 */
export function getSessionObjectTable(thread: ThreadContext): Map<string, SessionObject> {
  const root = rootOf(thread) as ThreadContext & { _objectTable?: Map<string, SessionObject> };
  if (!root._objectTable) root._objectTable = new Map();
  return root._objectTable;
}

/**
 * 把一个窗的 object 收敛到 session 对象表的**单一实例**：
 * - 表已有该 objectId → 令 `w.object` 指向表项（共享引用，改即处处见）。
 * - 表未有 → 以本窗 object 作首登记的 canonical（同 data.json hydrate 出，谁先登记等价）。
 *
 * 幂等：再次调对已共享的窗只是重新指向同一表项。fromThread / instantiate / hydrate 后调用。
 */
export function shareObjectIntoTable(thread: ThreadContext, w: OocObjectInstance): void {
  const table = getSessionObjectTable(thread);
  const key = objectKeyOf(w);
  const existing = table.get(key);
  if (existing) {
    w.object = existing;
  } else {
    table.set(key, w.object);
  }
}

/** object 彻底移除（lifecycle delete:true / 末-ref-evict）→ 同步从对象表删表项，杜绝悬空共享引用。 */
export function evictObjectFromTable(thread: ThreadContext, objectId: string): void {
  getSessionObjectTable(thread).delete(objectId);
}
