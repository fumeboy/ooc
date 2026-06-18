/**
 * readable 维度契约 —— ooc object **怎么投影成 context window** 给 LLM 看 + window method。
 *
 * 设计权威：`.ooc-world-meta/.../children/object/self.md`（对象模型单一权威）
 * 接口模板：同目录 `example.md`。本文件是该模板在 core 的**可编译落字**。
 *
 * 对象模型核心 4：object 持自身 Data（业务数据），由 readable 把 Data **投影**成 context window
 * —— 按视角动态算出 window 的 **class** 与展示 **content**。window 的投影态（`win`，如 viewport）
 * 与 object Data **分离**，由 **window method** 读写。
 *
 * window method **只动投影态、返回新的 win 对象（不可变）**，不改 object data、不产副作用
 * —— 与 executable 维度的 object method 维度隔离（同名 fail-loud）。
 */

import type { ThreadContext } from "../_shared/types/thread.js";
import type { MethodCallSchema } from "../_shared/types/intent.js";
import type { XmlNode } from "../_shared/types/xml.js";

/** readable / window method 的执行上下文（读侧；不携带改业务数据的能力）。 */
export interface ReadableContext {
  /** 正在「看」这个对象的 thread（视角来源；readable 可据此动态算 class）。 */
  thread?: ThreadContext;
  /** 被投影对象的身份信封（id / class）。 */
  object: { id: string; class: string };
  /** persistence 定位（readable 需读盘时用，如 file 读文件内容）。 */
  persistence?: { baseDir: string; sessionId?: string };
}

/**
 * readable 投影结果 —— object 经 readable 算出的「这一刻它作为 context window 的样子」。
 * - class   : 动态算出的 window class（同一 object 不同视角/状态可投影成不同 class）
 * - content : 渲染内容（结构化 XmlNode[] 或纯文本）
 * - consumedMessageIds : 本窗 transcript **已渲染**的 thread inbox/outbox 消息 id（会话窗投影把
 *   归属本窗的消息收进 transcript）。渲染器据此从顶层 `<inbox>`/`<outbox>` 兜底里**剔除**这些消息，
 *   保证「信息只渲一次」（context.md 核心 10）——一条消息要么进某窗 transcript、要么进顶层兜底，不重复。
 */
export interface ReadableProjection {
  class: string;
  content: XmlNode[] | string;
  consumedMessageIds?: string[];
}

/**
 * window method —— 调展示**程度/范围**（详细/部分/总结/压缩、viewport…）。
 *
 * 签名 `(ctx, self, before_win, args)` → **新的 win**：
 *   - self       : Data（只读；据业务数据算合法投影范围，如行数上限）
 *   - before_win : 当前投影态
 *   - 返回       : 新投影态（不可变；runtime 写回对象的 win）
 */
export interface WindowMethod<Data = any, Win = any, Args = any> {
  name: string;
  description: string;
  schema?: MethodCallSchema;
  exec: (
    ctx: ReadableContext,
    self: Data,
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

/** readable 维度模块 —— `readable/index.ts`（或 `readable.ts`）的 default export。 */
export interface ReadableModule<Data = any, Win = any> {
  readable: (
    ctx: ReadableContext,
    self: Data,
    win: Win,
  ) => ReadableProjection | Promise<ReadableProjection>;
  window: WindowClassDecl<Data, Win>[];
}
