/**
 * Context window 与对象引用相关的纯类型 + 纯函数 —— 不持业务逻辑。
 *
 * 设计权威：`.ooc-world-meta/.../children/object/self.md`（对象模型核心 4 + 三.细节补充）。
 *
 * 关键模型：
 * - `OocObjectRef` = context window = 对某 object 的引用 + 视角态。**`.data` 是 win 投影态**
 *   （window method 返回的形态），不是业务 data。
 * - 业务 data 活在 `OocObjectInstance` 上、由 session 对象表按 `ref.id` 解析。
 * - 同 objectId 多窗 ⇒ 同一表项 ⇒ 读同一份业务 data；每窗各持 own `.data` 投影态。
 */
import type { OocObjectRef, OocObjectInstance } from "../runtime/ooc-class.js";

/** ContextWindow 别名 —— 让旧消费方按"窗"语义读，本质是 OocObjectRef。 */
export type ContextWindow = OocObjectRef;
export type { OocObjectRef, OocObjectInstance } from "../runtime/ooc-class.js";

/** Root object 固定 id（每个 thread 的 contextWindows 顶层挂这个根锚）。 */
export const ROOT_WINDOW_ID = "root";

/** 取一个 context window 所引用对象的业务 data —— 经 session 对象表按 `ref.id` 解析。 */
export function objectDataOf<Data = unknown>(
  ref: OocObjectRef,
  table: Map<string, OocObjectInstance>,
): Data | undefined {
  return (table.get(ref.id) as OocObjectInstance<Data> | undefined)?.data;
}

/** 取一个 context window 所引用对象的注册 class（缓存在窗上、免查表）。 */
export function classOf(ref: OocObjectRef): string {
  return ref.class;
}

/** thread 窗 id 的稳定前缀；过去文件已沉淀此约定，保留以兼容现存 thread.json。 */
export const THREAD_WINDOW_ID_PREFIX = "w_creator_";

/** 派生稳定的 thread 自视角窗 id（thread 与 creator 的恒在通道）。 */
export function threadWindowIdOf(threadId: string): string {
  return `${THREAD_WINDOW_ID_PREFIX}${threadId}`;
}

/** 该窗是不是本 thread 的自视角过程窗 —— 由 id 派生（thread 窗身份编码在 id 里）。 */
export function isSelfThreadWindow(id: string): boolean {
  return id.startsWith(THREAD_WINDOW_ID_PREFIX);
}

/**
 * 提取 ref 的**对象身份**（剥离 window_view 等渲染 hint）供 equality / dedup 使用。
 *
 * issue J 后 ref 上 `window_view` 是「视角投影 hint」（非身份）—— 同一对象在 caller / callee
 * 两端的 ref 可持不同 window_view 但指向同一 inst。比较「是不是同一对象」时务必用此 helper
 * 剥离视角字段,而不是裸 ref 浅比较。
 */
export function refIdentity(ref: OocObjectRef): { id: string; class: string } {
  return { id: ref.id, class: ref.class };
}
