/**
 * compress —— thread 自我主历史窗的 compress policy（A 退潮：从 core/thinkable/context 搬入 thread builtin）。
 *
 * 镜像 Claude Code full-compact 的 Fork Agent：当 thread 窗未总结 transcript 超阈值（或 agent 显式
 * compress 置 intent），fork 一条 summarizer 子线程 seed 早期 transcript、令其单轮 `end({summary})`；
 * 完成由 harvest 读 child 摘要 → 记入 parent self-view thread 窗 `win.summarizedRanges` + 清 inFlightCompress。
 *
 * 分层：本文件是 **thread builtin 的 compress policy**（读写 thread 自己的业务字段 = ThreadWin 权威态）；
 * core thinkable 只留 **框架**——token 计数（budget）/ fork 原语（WindowManager.instantiate）/ isSummarizer
 * thinkloop 执行特化 / 纯阈值判定（compress-trigger）/ snapRangesToToolPairs·projectSummarizedRanges
 * 渲染折叠——并经 blessed thread import（同 writeThread）调本文件的 maybeAutoCompress / maybeForceWaitForCompress
 * （thinkloop hook）+ harvestSummarizerForks（scheduler tick）。compress 设计单一权威仍在 thinkable compress.md。
 *
 * compress.md 的「零副本重投影」refinement（与 say 读侧重投影同一能力）归 thread-as-referencable-object。
 */
import { isSelfThreadWindow } from "@ooc/core/_shared/types/context-window.js";
import { openForkChild } from "./fork.js";
import type { ProcessEvent } from "@ooc/core/_shared/types/thread.js"
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import { addSummarizedRange } from "@ooc/core/_shared/utils/summarized-ranges.js";
import { loadBudgetThresholds } from "@ooc/builtins/agent/thread/thinkable/context/budget.js";
import { shouldAutoCompress } from "@ooc/builtins/agent/thread/thinkable/context/compress-trigger.js";
import { writeThread } from "@ooc/core/persistable/thread-container-io.js";
import type { ThreadWin } from "@ooc/builtins/agent/thread/types.js";

/** 自动压缩保留的末尾 event 条数（保最近叙事；折早期段）。可调。 */
const KEEP_TAIL_EVENTS = 20;

function* iterateThreads(root: ThreadContext): Iterable<ThreadContext> {
  yield root;
  for (const child of Object.values(root.childThreads ?? {})) {
    yield* iterateThreads(child);
  }
}

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
    "（保留关键意图/决策/产物/待办，丢冗余细节）。\n" +
    "**直接把摘要作为你的纯文本回复输出**（你没有任何工具可用，也不要尝试调用工具）；" +
    "只输出摘要正文本身，不要前言后语。\n\n" +
    `=== 早期过程 events[${fromIdx}..${toIdx}] ===\n` +
    lines.join("\n")
  );
}

/**
 * 程序化 fork 一条 summarizer 子线程压缩 events[fromIdx..toIdx]，原子置 parent self-view thread 窗的
 * `win.inFlightCompress`。返回 child thread id（失败 undefined）。
 */
export async function spawnSummarizerFork(
  thread: ThreadContext,
  fromIdx: number,
  toIdx: number,
): Promise<string | undefined> {
  const selfObjectId = thread.persistence?.objectId;
  if (!selfObjectId || toIdx < fromIdx) return undefined;
  const seed = buildSummarizerSeed(thread.events ?? [], fromIdx, toIdx);

  // summarizer 是**内部 fork**：openForkChild 只挂 childThreads（scheduler 同 job 内跑）+ 投 seed，
  // 不在父侧建可见 fork 会话窗——harvest 直读 child.endSummary、不经父侧窗回报，故父无需该窗。
  const child = openForkChild(thread, {
    selfObjectId,
    msg: seed,
    wait: false,
    summarizer: true,
    title: "summarize early history",
  });
  const childId = child.id;

  const selfWindow = thread.contextWindows?.find((w) => isSelfThreadWindow(w.id));
  if (selfWindow) {
    const win = (selfWindow.win ?? (selfWindow.win = {})) as ThreadWin;
    win.inFlightCompress = { forkThreadId: childId, fromIdx, toIdx };
    win.compressIntent = undefined;
  }
  await writeThread(thread);
  return childId;
}

/**
 * compress auto-trigger —— thinkloop hook（buildInputItems 后、LLM call 前）。
 * 据 self-view thread 窗 autoCompressLevel/compressIntent + 未总结 transcript token 判定是否触发；
 * 触发则算待折区段（已折之后 → 保留末 N 条之前）并 spawn summarizer fork。
 */
export async function maybeAutoCompress(
  thread: ThreadContext,
  transcriptTokens: number,
): Promise<void> {
  // summarizer fork 自身不再自动压缩（防递归 spawn）；其 seed 若超 budget 由 buildInputItems clamp floor 兜底。
  if (thread.isSummarizer) return;
  const win = thread.contextWindows?.find((w) => isSelfThreadWindow(w.id))?.win as
    | ThreadWin
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
  const lastFolded = (win.summarizedRanges ?? []).reduce((m, r) => Math.max(m, r.toIdx), -1);
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
 * compress force-wait —— thinkloop（auto-trigger 后、LLM call 前）。
 * context 超 hard **且**有在途 summarizer fork → 把本线程切 waiting（waitingOn="compress:<forkId>"），
 * 本轮不 LLM call；fork 完成由 harvest 折叠 + 直接唤醒。无在途 compress → 不 force-wait（clamp floor 兜底）。
 * 返回 true 表示已切 waiting（调用方应 return 本轮）。summarizer fork 自身不 force-wait（防自锁）。
 */
export function maybeForceWaitForCompress(
  thread: ThreadContext,
  transcriptTokens: number,
): boolean {
  if (thread.isSummarizer) return false;
  const win = thread.contextWindows?.find((w) => isSelfThreadWindow(w.id))?.win as
    | ThreadWin
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

/**
 * harvest summarizer fork（scheduler tick 顶部调）—— A 退潮：从 core scheduler 搬入 thread builtin。
 *
 * 对每个 self-view thread 窗带 `inFlightCompress` 的线程：找其 summarizer 子线程——
 * - done → 读 child.endSummary 记入父窗 `summarizedRanges` + push 可见 `context_compressed` 事件；
 * - failed / orphan → 不记 fold（clamp floor 兜底防溢出）；
 * 之后清 `inFlightCompress`；若父在本 compress 上 waiting → 翻 running 唤醒（内部回收，不污染 inbox）。
 */
export function harvestSummarizerForks(root: ThreadContext): void {
  for (const thread of iterateThreads(root)) {
    const selfWin = thread.contextWindows?.find((w) => isSelfThreadWindow(w.id))?.win as
      | ThreadWin
      | undefined;
    const inFlight = selfWin?.inFlightCompress;
    if (!selfWin || !inFlight) continue;
    const child = thread.childThreads?.[inFlight.forkThreadId];
    if (child && child.status !== "done" && child.status !== "failed") continue; // 还在跑
    if (child && child.status === "done") {
      const summary = (child.endSummary ?? "").trim() || "(summarizer 未产出摘要)";
      selfWin.summarizedRanges = addSummarizedRange(selfWin.summarizedRanges, {
        fromIdx: inFlight.fromIdx,
        toIdx: inFlight.toIdx,
        summary,
      });
      thread.events = [
        ...thread.events,
        { category: "context_change", kind: "context_compressed", levelChange: "auto-fold", reason: "auto-summarized" },
      ];
    } else if (child && child.status === "failed") {
      // summarizer fork 失败：关掉本窗自动压缩（防反复 spawn-fail livelock），插可见 note；clamp floor 兜底。
      selfWin.autoCompressLevel = 0;
      thread.events = [
        ...thread.events,
        {
          category: "context_change",
          kind: "context_compressed",
          levelChange: "auto-fold-failed",
          reason: "summarizer-fork-failed; auto-compress 已关闭，可 resize 重开",
        },
      ];
    }
    selfWin.inFlightCompress = undefined;
    if (thread.status === "waiting" && (thread.waitingOn ?? "").startsWith("compress:")) {
      thread.status = "running";
      thread.inboxSnapshotAtWait = undefined;
      thread.waitingOn = undefined;
    }
  }
}
