/**
 * thinkable 维度契约 —— ooc class 的 **thinkable 模块**接口（OocClass 第五模块槽）。
 *
 * 设计权威：`.ooc-world-meta/.../children/thinkable/self.md` + 本 issue
 * `docs/issues/2026-06-23-thinkable-module-context-decoupling.md`。
 *
 * thinkable = 「一个 class 如何把自己组织进 thinkloop 的一轮 think」。core 的 thinkloop / scheduler
 * 是**泛型驱动器**——它们不再自己构造/更新 context，而是经 registry 解析出运行 thread 的 class 的
 * thinkable 模块、调用其注册的函数。context 构造（buildInputItems）/ 事件折入（appendEvents）/
 * compress 决策 / 每 tick 维护（onSchedulerTick）全是 thread builtin 的 thinkable 实现，**不在 core**。
 *
 * **签名约定 `(ctx, …)`** —— 与 `ObjectMethod.exec(ctx, self, args)` / `ReadableModule.readable(ctx, self, win)`
 * 同构：模块函数拿 `ctx`、**不拿裸 thread**。正在 think/调度的那条线程经 `ctx.thread` 取
 * （core thinkloop/scheduler 持有 ThreadContext，调用前包成 `{ thread }`）。
 *
 * **纯类型、零 thread builtin import**：只引 core 的 ThreadContext / ProcessEvent / LlmInputItem。
 */

import type { ThreadContext, ProcessEvent } from "../_shared/types/thread.js";
import type { LlmInputItem } from "./llm/types.js";

/**
 * thinkable 模块函数的执行上下文。
 *
 * 最小形态 `{ thread }`——正在 think/调度的那条线程（onSchedulerTick 时为 rootThread）。
 * 额外 per-tick 输入（如 transcriptTokens）走函数形参、不塞 ctx；registry 是单例
 * （builtinRegistry，impl 直接 import）、persistence 在 `thread.persistence`——故都不进 ctx。
 * 按需可加 optional 运行时句柄而不改函数签名。
 *
 * **thread.status / isSummarizer / endSummary / statusReason / lastError 对 thinkable 只读**
 * （它们是 core scheduler/thinkloop 的调度控制字段，写归 core）。
 */
export interface ThinkableContext {
  /** 正在 think/调度的那条线程。 */
  thread: ThreadContext;
}

/** buildInputItems 的产出：LLM 一轮的 instruction + input items + transcript token 估算。 */
export interface BuildInputResult {
  instructions?: string;
  input: LlmInputItem[];
  transcriptTokens?: number;
}

/**
 * thinkable 模块 —— `index.ts` 的 `export const Class.thinkable`。
 *
 * 窄接口（纯 per-tick）：core thinkloop/scheduler 经 `thinkableOf(thread)` 解析后调用。
 *
 * - buildInputItems : 读侧——thread context → LLM 一轮输入（含每轮 peer reconcile + 窗幂等重铺）。
 * - appendEvents    : 写侧——core 每步产出的 ProcessEvent 折进 thread 历史（**单一 ingest**：
 *                     取代 thinkloop 直接 `thread.events.push`）。推**原始 event**，event→item 转流在
 *                     buildInputItems 读侧。与 writeThread（persistable 落盘）正交：本函数只动内存历史。
 * - maybeAutoCompress / maybeForceWaitForCompress : compress v2 触发/强等（thinkloop 每轮）。
 * - onSchedulerTick : scheduler 每 tick 顶部的线程树维护（thread 内部 = harvest + child-notify 按序，
 *                     core 不知两子步顺序、只调一个钩子）。
 */
export interface ThinkableModule<Data = any> {
  buildInputItems(ctx: ThinkableContext): Promise<BuildInputResult>;
  appendEvents(ctx: ThinkableContext, events: ProcessEvent[]): void;
  maybeAutoCompress(ctx: ThinkableContext, transcriptTokens: number): Promise<void>;
  maybeForceWaitForCompress(ctx: ThinkableContext, transcriptTokens: number): boolean;
  onSchedulerTick(ctx: ThinkableContext): void;
}
