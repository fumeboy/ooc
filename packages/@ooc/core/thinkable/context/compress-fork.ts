/**
 * compress v2 —— summarizer fork（framework 程序化 fork 子线程生成摘要）。
 *
 * 镜像 Claude Code full-compact 的 Fork Agent：当 thread 窗未总结 transcript 超阈值（或 agent 显式
 * compress 置 intent），framework 经 `runtime.instantiate(THREAD_CLASS_ID,{target:self})` fork 一条
 * 子线程，seed 早期 transcript，令其单轮生成摘要后 `end({summary})`。完成由 scheduler harvest 读 child
 * 摘要 → 记入 parent **self-view thread 窗** `win.summarizedRanges{fromIdx,toIdx,summary}` + 清 inFlightCompress。
 *
 * 分层：core 经 builtinRegistry + WindowManager.instantiate 桥接到 builtins thread 构造（execFork），
 * 无 core→builtins 直接 import（registry 解析；writeThread 沿用 thinkloop 既有 builtins import 模式）。
 */
import { builtinRegistry } from "../../runtime/object-registry.js";
import { WindowManager } from "../../runtime/window-manager.js";
import { THREAD_CLASS_ID } from "../../_shared/types/constants.js";
import { isSelfThreadWindow } from "../../_shared/types/context-window.js";
import { writeThread } from "@ooc/builtins/agent/thread/persistable/thread-json.js";
import type { ThreadContext, ProcessEvent } from "../context.js";
import type { SummarizedRange } from "../../_shared/utils/summarized-ranges.js";
import { loadBudgetThresholds } from "./budget.js";
import { shouldAutoCompress } from "./compress-trigger.js";

/** self-view thread 窗投影态里 compress v2 关心的子集（loose；权威定义在 builtins ThreadWin）。 */
interface CompressV2Win {
  summarizedRanges?: SummarizedRange[];
  compressIntent?: boolean;
  autoCompressLevel?: 0 | 1 | 2;
  inFlightCompress?: { forkThreadId: string; fromIdx: number; toIdx: number };
}

/** 自动压缩保留的末尾 event 条数（保最近叙事；折早期段）。可调。 */
const KEEP_TAIL_EVENTS = 20;

/** 把 events[fromIdx..toIdx] 渲成给 summarizer fork 的种子文本（轻量、单轮足够）。 */
export function buildSummarizerSeed(
  events: ProcessEvent[],
  fromIdx: number,
  toIdx: number,
): string {
  const slice = events.slice(fromIdx, toIdx + 1);
  const lines = slice.map((e, i) => {
    const idx = fromIdx + i;
    const ev = e as Record<string, unknown>;
    if (e.category === "llm_interaction" && e.kind === "text") return `#${idx} [me] ${ev.text ?? ""}`;
    if (e.category === "llm_interaction" && e.kind === "function_call")
      return `#${idx} [tool_call] ${ev.toolName ?? ""}(${JSON.stringify(ev.arguments ?? {}).slice(0, 300)})`;
    if (e.category === "tool_runtime" && e.kind === "function_call_output")
      return `#${idx} [tool_result] ${ev.toolName ?? ""}: ${String(ev.output ?? "").slice(0, 500)}`;
    if (e.category === "context_change")
      return `#${idx} [context_change:${e.kind}] ${String(ev.text ?? "")}`;
    return `#${idx} [${e.category}/${e.kind}]`;
  });
  return (
    "你被 fork 出来执行一个**单一任务**：把下面这段早期对话过程浓缩成一条简洁摘要" +
    "（保留关键意图/决策/产物/待办，丢冗余细节）。完成后**立刻**调用 end，" +
    'args={summary: "<你的摘要正文>"}。不要做任何别的事、不要调用其它工具。\n\n' +
    `=== 早期过程 events[${fromIdx}..${toIdx}] ===\n` +
    lines.join("\n")
  );
}

/**
 * 程序化 fork 一条 summarizer 子线程压缩 events[fromIdx..toIdx]，原子置 parent self-view thread 窗的
 * `win.inFlightCompress`（H2：spawn 后 toData sync → 在同步后的 contextWindows 上 mutate → writeThread，
 * 故下轮 buildInputItems 读到 inFlightCompress；丢弃的临时 mgr 不影响）。返回 child thread id（失败 undefined）。
 */
export async function spawnSummarizerFork(
  thread: ThreadContext,
  fromIdx: number,
  toIdx: number,
): Promise<string | undefined> {
  const selfObjectId = thread.persistence?.objectId;
  if (!selfObjectId || toIdx < fromIdx) return undefined;
  const seed = buildSummarizerSeed(thread.events ?? [], fromIdx, toIdx);

  const mgr = WindowManager.fromThread(thread, builtinRegistry);
  await mgr.attachPersistence(thread);
  const before = new Set(thread.childThreadIds ?? []);
  // target=self → thread 构造走 execFork（同 object 内存树 sub-thread，同 job scheduler loop 内跑）。
  await mgr.instantiate(THREAD_CLASS_ID, {
    target: selfObjectId,
    msg: seed,
    wait: false,
    summarizer: true,
    title: "summarize early history",
  });
  thread.contextWindows = mgr.toData();
  const childId = (thread.childThreadIds ?? []).find((id) => !before.has(id));
  if (!childId) return undefined;

  // 移除 instantiate 留下的父侧 summarizer fork **窗**——summarizer 是内部 fork：child 在
  // childThreads 由 scheduler 跑、harvest 直读 child.endSummary、不经父侧窗回报，故父无需该窗
  // （否则污染 agent 窗列表 + wait 候选）。child thread（childThreads[childId]）保留。
  thread.contextWindows = (thread.contextWindows ?? []).filter((w) => {
    const d = (w.data ?? {}) as { targetThreadId?: string; isForkWindow?: boolean };
    return !(d.isForkWindow === true && d.targetThreadId === childId);
  });

  const selfWindow = thread.contextWindows?.find((w) => isSelfThreadWindow(w.id));
  if (selfWindow) {
    const win = (selfWindow.win ?? (selfWindow.win = {})) as CompressV2Win;
    win.inFlightCompress = { forkThreadId: childId, fromIdx, toIdx };
    win.compressIntent = undefined;
  }
  await writeThread(thread);
  return childId;
}

/**
 * compress v2 auto-trigger —— thinkloop hook（buildInputItems 后、LLM call 前）。
 * 据 self-view thread 窗 autoCompressLevel/compressIntent + 未总结 transcript token（transcript-gated H3）
 * 判定是否触发；触发则算待折区段（已折之后 → 保留末 N 条之前）并 spawn summarizer fork（H2 原子置 inFlight）。
 * dormant：autoCompressLevel/compressIntent 均未设、且 transcript 未超 level 阈值时不触发（与原行为同）。
 */
export async function maybeAutoCompress(
  thread: ThreadContext,
  transcriptTokens: number,
): Promise<void> {
  // summarizer fork 自身不再自动压缩（防递归 spawn）；其 seed 若超 budget 由 buildInputItems clamp floor 兜底。
  if (thread.isSummarizer) return;
  const win = thread.contextWindows?.find((w) => isSelfThreadWindow(w.id))?.win as
    | CompressV2Win
    | undefined;
  if (!win) return;
  const thresholds = loadBudgetThresholds(thread);
  if (
    !shouldAutoCompress({
      transcriptTokens,
      autoCompressLevel: win.autoCompressLevel,
      compressIntent: win.compressIntent,
      inFlight: !!win.inFlightCompress,
      thresholds,
    })
  ) {
    return;
  }
  const events = thread.events ?? [];
  const lastFolded = (win.summarizedRanges ?? []).reduce(
    (m, r) => Math.max(m, r.toIdx),
    -1,
  );
  const fromIdx = lastFolded + 1;
  const toIdx = events.length - 1 - KEEP_TAIL_EVENTS;
  if (toIdx < fromIdx) {
    // 无可折早期段（保留末 N 条已覆盖剩余）——清 intent 防反复空触发。
    if (win.compressIntent) win.compressIntent = undefined;
    return;
  }
  await spawnSummarizerFork(thread, fromIdx, toIdx);
}

/**
 * compress v2 force-wait —— thinkloop（auto-trigger 后、LLM call 前）。
 * context 超 hard **且**有在途 summarizer fork → 把本线程切 waiting（waitingOn="compress:<forkId>"），
 * 本轮不 LLM call；fork 完成由 harvest 折叠 + 直接唤醒。即「宁等富摘要、不给 LLM 看 lossy clamp」。
 * 无在途 compress（fork 未起/已失败）→ 不 force-wait，本轮照走 buildInputItems 的 clamp floor（保不崩，C3）。
 * 返回 true 表示已切 waiting（调用方应 return 本轮）。summarizer fork 自身不 force-wait（防自锁）。
 */
export function maybeForceWaitForCompress(
  thread: ThreadContext,
  transcriptTokens: number,
): boolean {
  if (thread.isSummarizer) return false;
  const win = thread.contextWindows?.find((w) => isSelfThreadWindow(w.id))?.win as
    | CompressV2Win
    | undefined;
  const inFlight = win?.inFlightCompress;
  if (!inFlight) return false;
  const thresholds = loadBudgetThresholds(thread);
  if (transcriptTokens <= thresholds.hard) return false; // 未超 hard：proactive 场景继续，不必等
  thread.status = "waiting";
  thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
  thread.waitingOn = `compress:${inFlight.forkThreadId}`;
  return true;
}
