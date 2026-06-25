import type { MethodCallSchema } from "./intent.js";
import type { XmlNode } from "./xml.js";
import type { ReadonlySelfProxy } from "./self-proxy.js";
import type { OocObjectRef } from "../runtime/ooc-class.js";

/**
 * readable / window method 的执行上下文（读侧；不携带改业务数据的能力）。
 *
 * - `object` : 接收者对象的身份元信息（id / class）。业务 data 经 self 入参，**不**在此。
 */
export interface ReadableContext {
  object: { id: string; class: string };
}

/**
 * readable 渲染输出 —— readable render 返回值。
 *
 * - `class`     : 本次投影出的 window class 名（按视角动态算；可与对象注册 class 不同）
 * - `content`   : 渲染产物（XML 节点数组或裸文本）
 * - `win`       : 渲染期可顺手返回的新窗投影态（覆写 `ref.data`）；不返回则保持
 * - `consumedMessageIds` : 本窗在 transcript 内已渲过的 thread message id，给 thinkable 兜底剔除
 */
export interface ReadableProjection<WinData = unknown> {
  class: string;
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
 * 一个 window class 声明 —— readable 可注册多个（同一 object 按视角投影成不同 class）。
 *
 * - class          : 该投影 class 名
 * - object_methods : 该 window 上**展示**哪些 object method（按名引用 executable 的方法）
 * - window_methods : 该 window 提供的 window method
 */
export interface WindowClassDecl<Data = unknown, Win = unknown> {
  class: string;
  object_methods: string[];
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
  window: WindowClassDecl<Data, Win>[];
}
