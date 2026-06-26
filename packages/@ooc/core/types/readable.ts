import type { MethodCallSchema } from "./intent.js";
import type { XmlNode } from "./xml.js";
import type { ReadonlySelfProxy } from "./self-proxy.js";
import type { OocObjectRef } from "../runtime/ooc-class.js";

/**
 * readable / window method 的执行上下文（读侧；不携带改业务数据的能力）。
 *
 * - `object`  : 接收者对象的身份元信息（id / class）。业务 data 经 self 入参,**不**在此。
 * - `intents` : 本轮 thinkloop 从 thread.contextWindows 聚合的 intent 集合（issue N）。core 跑
 *               `scanIntents` 经每条 ref 的 `class.readable.intents?.(self)` 收集 + Set 去重后注入
 *               所有 readable render。消费方：knowledge_base 等"基于意图的资源激活"实现。
 *               stateless 投影：每轮 thinkloop 重算、不缓存,form close 后自然消失。
 *               命名空间约定:
 *                 - `intent::class::<class>` —— 每条 contextWindows ref 经 root readable.intents 产
 *                 - `intent::form_open::<targetClass>::<guideName>` —— method_exec_form 产
 *                 - `intent::super_flow::active` —— super flow 内 thread 产
 *                 - `intent::user::<name>` —— 用户 ooc class 自定义命名空间
 */
export interface ReadableContext {
  object: { id: string; class: string };
  intents: Set<string>;
}

/**
 * readable 渲染输出 —— readable render 返回值。
 *
 * - `view`     : 本次投影出的 window view 名（按视角动态算；与 OocObjectRef.class 是两个概念,
 *                view 描述「投影方案」/「视角」,如 `default` / `self` / `super` / `talk`）
 * - `content`   : 渲染产物（XML 节点数组或裸文本）
 * - `win`       : 渲染期可顺手返回的新窗投影态（覆写 `ref.data`）；不返回则保持
 * - `consumedMessageIds` : 本窗在 transcript 内已渲过的 thread message id,给 thinkable 兜底剔除
 */
export interface ReadableProjection<WinData = unknown> {
  view: string;
  content: XmlNode[] | string;
  win?: WinData;
  consumedMessageIds?: string[];
}

/** @deprecated 用 ReadableProjection 替代；保留别名让旧 import 不立刻断。 */
export type ReadableOutput<WinData = unknown> = ReadableProjection<WinData>;

/**
 * window method —— 调展示**程度/范围**（详细/部分/总结/压缩、viewport…）。
 *
 * 签名 `(ctx, self, before_win, args)` → **新的 win**（= 新的 `OocObjectRef.data`）：
 *   - self       : ReadonlySelfProxy<Data>（`self.data` 只读；据业务数据算合法投影范围）
 *   - before_win : 当前投影态
 *   - 返回       : 新投影态（不可变；runtime 写回 ref.data）
 */
export interface WindowMethod<Data = unknown, Win = unknown, Args = any> {
  name: string;
  description: string;
  schema?: MethodCallSchema;
  exec: (
    ctx: ReadableContext,
    self: ReadonlySelfProxy<Data>,
    before_win: Win,
    args: Args,
  ) => Win | Promise<Win>;
}

/**
 * 一个 window view 声明 —— readable 可注册多个（同一 object 按视角投影成不同 view）。
 *
 * - view           : 该投影视角名（`default` / `self` / `super` / `talk` 等；与 OocObjectRef.class
 *                    即对象 class id 是正交概念）
 * - object_methods : 该 window 上**展示**哪些 object method（按名引用 ExecutableModule.methods）
 * - guide_methods  : 该 window 上**展示**哪些 guide method（按名引用 ExecutableModule.guides）。
 *                    method/guide 命名空间共用 dispatch 入口；同名互斥,注册期校验。
 * - window_methods : 该 window 提供的 window method
 */
export interface WindowViewDecl<Data = unknown, Win = unknown> {
  view: string;
  object_methods: string[];
  guide_methods?: string[];
  window_methods: WindowMethod<Data, Win>[];
}

/** readable render —— 把 object 业务 data + 当前 window ref 投影成 ReadableProjection。 */
export type ReadableRender<Data = unknown, Win = unknown> = (
  ctx: ReadableContext,
  self: ReadonlySelfProxy<Data>,
  win: OocObjectRef<Win>,
) => ReadableProjection<Win> | Promise<ReadableProjection<Win>>;

/** readable 维度模块 —— `readable/index.ts` 的 default export。 */
export interface ReadableModule<Data = unknown, Win = unknown> {
  readable: ReadableRender<Data, Win>;
  window: WindowViewDecl<Data, Win>[];
  /**
   * 可选:本 class 暴露给上下文聚合的 intents（issue N）。
   *
   * 由 `core/thinkable/context/scanIntents.ts` 在每轮 thinkloop 调一次,把所有 contextWindows ref 的产出
   * Set 去重后注入 ReadableContext.intents。**stateless 投影**——每轮重算、无缓存。
   *
   * 入参签名与 `readable.readable` 对齐:接 self (对象业务数据) + ref (OocObjectRef,可看 ref.id /
   * ref.window_view / ref.data 判断本 ref 在 context 中的视角与状态)。
   *
   * 缺省 undefined = 本 class 不产 intent（与协议向后兼容）。多数 builtin 不实现此槽；典型实现:
   * - `method_exec_form` —— 产 `form_open::<targetClass>::<guideName>` + user intents
   * - `thread`           —— 据 ref.window_view + sessionId 产 `class::root` / `class::talk` /
   *                          `super_flow::active`
   */
  intents?: (self: ReadonlySelfProxy<Data>, ref: OocObjectRef<Win>) => readonly string[];
}
