/**
 * core/types/lifecycle.ts —— lifecycle 维度类型契约。
 *
 * **lifecycle 是 object base 第 5 维**（issue 2026-06-28-lifecycle-module-and-reload）——
 * 与 readable/executable/visible/persistable 并列、构成 object 的「自我」（self-constitutive）。
 *
 * 注册槽 = OocClass.lifecycle: LifecycleModule，三可选钩：
 * - `active`    : refcount 0→1 派发（首次激活；class 级 long-lived service 在此一次初始化）
 * - `unactive`  : refcount 1→0 派发（停用；可返回 {delete:true} 自决彻底删除）
 * - `on_reload` : hot-reload 链路触发（class 源码变更、新代码接管前；用于资源/内存态重建：
 *                 重启 watcher / 重接外部连接 / 清 in-memory cache / 重算派生态）
 *
 * **设计权威**：`.ooc-world-meta/.../objects/supervisor/children/lifecycle/self.md`。
 *
 * 命名警示：`thinkable.active(data) => boolean` 谓词（issue E 引入）与 `lifecycle.active` 钩**同名、不同语义**——
 * 前者判 thinkable 类实例是否终态（用于 GC），后者是 refcount 0→1 激活钩。future issue 处理重命名。
 */

import type { ConstructorContext } from "./executable.js";

/**
 * 对象生命周期钩子的执行上下文 —— 在 construct 上下文之上携带 refcount 变动的目标 id。
 *
 * 生命周期钩子作用于**既有**对象（不产 Data）；body 经 ctx 自解析它要操作的对象：
 * `targetId` 是 refcount 跨 0↔1 的对象 id（active/unactive）或 reload 的对象 id（on_reload）。
 */
export interface LifecycleContext extends ConstructorContext {
  /** 钩子 body 据此定位自己要操作的对象。 */
  targetId: string;
  reportDataEdit: () => Promise<void>;
}

/** unactive 返回值：delete:true → core 把 object 彻底从 session 移除（含持久化文件）；缺省=只停用。 */
export interface UnactiveResult {
  delete?: boolean;
}

/**
 * 对象生命周期钩子（active/unactive 共用）—— 与 construct 对称、按 refcount 0↔1 触发。
 * 作用于**既有**对象（不产 Data）；`self` = refcount 跨界的**目标对象的业务 data**（由 runtime 解析
 * `ctx.targetId` 注入），body 直接操作 `self`、不必从 ctx 自解析目标。无目标 data 时 `self` 为 undefined。
 * 皆可选。无独立 destruct —— OOC object 默认持久身份；unactive 可经返回 {delete:true} 自决彻底删除
 * （refcount-0-gated，故无悬空引用）。仅 unactive 路径 honor delete；active 返回值忽略。
 */
export interface ObjectLifecycleHook<Data = any> {
  description: string;
  exec: (
    ctx: LifecycleContext,
    self: Data,
  ) => void | UnactiveResult | Promise<void | UnactiveResult>;
}

/**
 * 热更新钩子 —— hot-reload 链路触发（class 源码变更、实例首次承新代码运行前）。
 *
 * 用于处理 in-memory cache、watcher、外部连接、派生态等热更新时需重建的资源。
 * `info.changedFiles` 是本次触发该 class invalidate 的源文件相对路径列表（用于精细判定）。
 *
 * 派发时机：`hot-reload → invalidateStone → 标记该 class pendingReload → ThreadRuntime 下次接触
 *           该 class 任一 inst 时（首次 method 调用 / dispatchActive 前）触发 on_reload`。
 *
 * **顺序**：on_reload **before** active —— 资源就位先于激活。
 *
 * 失败语义：**fail-loud**（与 OOC fail-loud 哲学一致）。class 自承迁移失败后果。
 */
export interface OnReloadHook<Data = any> {
  description: string;
  exec: (
    ctx: LifecycleContext,
    self: Data,
    info: { changedFiles?: string[] },
  ) => void | Promise<void>;
}

/**
 * lifecycle 维度模块 —— object base 第 5 维（issue 2026-06-28-lifecycle-module-and-reload）。
 *
 * 装配方式：class `index.ts` 的 `export const Class` 装配处加 `lifecycle: { ... }`。
 * 三钩可选；省略 = runtime 不派发对应钩。
 */
export interface LifecycleModule<Data = any> {
  /** refcount 0→1 派发（首次激活）。 */
  active?: ObjectLifecycleHook<Data>;
  /** refcount 1→0 派发（停用 / 自决删除）。 */
  unactive?: ObjectLifecycleHook<Data>;
  /** hot-reload 链路触发（新代码接管前的资源重建）。 */
  on_reload?: OnReloadHook<Data>;
}
