/**
 * thread —— thinkable 维度（OocClass.thinkable 模块实现）。
 *
 * thread 是跑 thinkloop 的载体 class；它向 core 注册「如何把自己组织进一轮 think」：
 * - buildInputItems : 构造 LLM 一轮输入（context 渲染 + transcript 投影 + budget + 每轮 peer reconcile）。
 * - appendEvents    : 单一 ingest——core 每步产出的 ProcessEvent 折进 thread.events（取代 core 直接 push）。
 * - maybeAutoCompress / maybeForceWaitForCompress : compress v2 触发/强等（thread policy）。
 * - onSchedulerTick : scheduler 每 tick 顶部的线程树维护 = harvest summarizer fork + child-end 通知（按序）。
 *
 * core thinkloop/scheduler 经 `thinkableOf(thread)`（registry 解析）调本模块，**不再静态 import 本 builtin**。
 *
 * context 构造实现物理在本目录 `./context/`（P2 从 core/thinkable/context 整树搬入）；compress policy
 * 在本 builtin executable。
 */
import type { ThinkableModule, ThinkableContext } from "@ooc/core/thinkable/contract.js";
import { buildInputItems as coreBuildInputItems } from "./context/index.js";
import {
  maybeAutoCompress as threadMaybeAutoCompress,
  maybeForceWaitForCompress as threadMaybeForceWaitForCompress,
  harvestSummarizerForks,
} from "@ooc/builtins/agent/thread/executable/compress.js";
import { emitChildEndNotifications } from "@ooc/builtins/agent/thread/executable/child-notify.js";
import type { Data } from "../types.js";

const thinkable: ThinkableModule<Data> = {
  buildInputItems: (ctx: ThinkableContext) => coreBuildInputItems(ctx.thread),
  appendEvents: (ctx: ThinkableContext, events) => {
    ctx.thread.events.push(...events);
  },
  maybeAutoCompress: (ctx: ThinkableContext, transcriptTokens) =>
    threadMaybeAutoCompress(ctx.thread, transcriptTokens),
  maybeForceWaitForCompress: (ctx: ThinkableContext, transcriptTokens) =>
    threadMaybeForceWaitForCompress(ctx.thread, transcriptTokens),
  onSchedulerTick: (ctx: ThinkableContext) => {
    // 顺序属 thread 内部：先 harvest summarizer fork 摘要折段，再发 child-end 通知。core 只调一个钩子。
    harvestSummarizerForks(ctx.thread);
    emitChildEndNotifications(ctx.thread);
  },
};

export default thinkable;
