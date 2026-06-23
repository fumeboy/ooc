import type { MethodCallSchema } from "../_shared/types/intent.js";
import type { XmlNode } from "../_shared/types/xml.js";
import type { ReadonlySelfProxy } from "../_shared/types/self-proxy.js";
import { OocObjectRef } from "@src/runtime/ooc-class.js";

/** readable / window method 的执行上下文（读侧；不携带改业务数据的能力）。 */
export interface ReadableContext {

}

export interface ReadableOutput<WinData = any> {
  content: XmlNode[] | string;
  win?: WinData
}

/**
 * window method —— 调展示**程度/范围**（详细/部分/总结/压缩、viewport…）。
 *
 * 签名 `(ctx, self, before_win, args)` → **新的 win**：
 *   - self       : ReadonlySelfProxy<Data>（`self.data` 只读；据业务数据算合法投影范围，如行数上限）
 *   - before_win : 当前投影态
 *   - 返回       : 新投影态（不可变；runtime 写回对象的 win）
 */
export interface WindowMethod<Data = any, Win = any, Args = any> {
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
 * - class          : 该投影 class 名
 * - object_methods : 该 window 上**展示**哪些 object method（按名引用 executable 的方法）
 * - window_methods : 该 window 提供的 window method
 */
export interface WindowClassDecl<Data = any, Win = any> {
  class: string;
  object_methods: string[];
  window_methods: WindowMethod<Data, Win>[];
}

export interface ReadableModule<Data = any, Win = any> {
  readable: (
    ctx: ReadableContext,
    self: ReadonlySelfProxy<Data>,
    win: OocObjectRef<Win>,
  ) => ReadableOutput | Promise<ReadableOutput>;
  window: WindowClassDecl<Data, Win>[];
}
