import type { LlmInputItem } from "../llm/types";
import { isBuiltinObjectId, objectDir, resolveStoneIdentityRef, stoneDir, threadDir } from "../../persistable";
import { createDefaultPipeline } from "./pipeline.js";
import {
  estimateTranscriptTokens,
  estimateWindowsTokens,
  loadBudgetThresholds,
  type BudgetThresholds,
} from "./budget.js";
import { clampTranscriptToBudget } from "./transcript-clamp.js";
import { XmlRenderer } from "./renderers/xml.js";
import type { OocObjectInstance } from "../../runtime/ooc-class.js";
import { isTalkLikeClass } from "../../_shared/types/constants.js";
import { isCreatorWindowId } from "../../_shared/types/context-window.js";
import {
  normalizeSummarizedRanges,
  projectSummarizedRanges,
  type SummarizedRange,
} from "../../_shared/utils/summarized-ranges.js";
import type { ProcessEvent, ThreadContext, ThreadMessage } from "../../_shared/types/thread.js";

export type {
  MethodCallSchema,
  MethodArgSpec,
} from "@ooc/core/_shared/types/intent.js";

export { BudgetManager } from "./budget.js";
export type { ContextSnapshot } from "./snapshot.js";
export { XmlRenderer } from "./renderers/xml.js";
export { ContextPipeline, createDefaultPipeline } from "./pipeline.js";
export type { PipelinePhase, PipelineContext } from "./pipeline.js";

/**
 * Thread 运行时类型 —— canonical 源在 `@ooc/core/_shared/types/thread.ts`；
 * 此处 re-export 保持旧 import 路径 (`thinkable/context`) 可用，并打破
 * thinkable → executable 的类型反向依赖（ContextWindow 现从 `_shared` 单向引入）。
 */
export type {
  ProcessEventCommon,
  ProcessEvent,
  ThreadMessage,
  ThreadStatus,
  ThreadContext,
} from "../../_shared/types/thread.js";

/** 基于 msgId 在 inbox 中查找实际消息正文。 */
function findInboxMessage(thread: ThreadContext, msgId: string): ThreadMessage | undefined {
  return thread.inbox?.find((message) => message.id === msgId);
}

/**
 * 推导 inbox 消息在接收方(当前 thread)视角下所属的 talk_window id（peer / fork 子窗）。
 *
 * 推导链:
 * 1. inboxMessage.replyToWindowId — talk-delivery / worker.syncCrossObjectCalleeEnds
 *    在跨 object 投递时已经写入,优先使用
 * 2. fallback: 在 thread.contextWindows 中找一个 fork 子线程窗（会话窗 + data.isForkWindow）且
 *    data.targetThreadId === inboxMessage.fromThreadId 的 window;若多个,优先 creator 窗
 *    （isCreatorWindowId(id)——child 视角下的 creator fork 窗是规范配对窗口；它的 self-view class
 *    是 thread/reflect_request，故按 isTalkLikeClass 认会话窗而非死写 "talk"）
 * 3. 都没有 → undefined,header 中静默不输出 window_id KV
 */
function resolveInboxWindowId(thread: ThreadContext, inboxMessage: ThreadMessage): string | undefined {
  if (inboxMessage.replyToWindowId) return inboxMessage.replyToWindowId;
  const fromThreadId = inboxMessage.fromThreadId;
  if (!fromThreadId) return undefined;
  const candidates = thread.contextWindows.filter((w) => {
    if (!isTalkLikeClass(w.class)) return false;
    const d = (w.data ?? {}) as { isForkWindow?: boolean; targetThreadId?: string };
    return d.isForkWindow === true && d.targetThreadId === fromThreadId;
  });
  if (candidates.length === 0) return undefined;
  const creator = candidates.find((w) => isCreatorWindowId(w.id));
  return (creator ?? candidates[0])!.id;
}

/** 把过程事件转换为 Responses-first input items；返回空数组表示该事件不进 transcript。 */
function processEventToItems(thread: ThreadContext, event: ProcessEvent): LlmInputItem[] {
  if (event.category === "context_change" && event.kind === "inbox_message_arrived") {
    const inboxMessage = findInboxMessage(thread, event.msgId);

    // attention 分层（2026-06-14）：会话内容只渲一次，message 流里的形态按 attention 分。
    // - 归属本线程 **creator 窗**（与派活方的主对话，主要 attention）→ message 流出**全文**（此处往下走，强 attend）；
    //   creator 窗在 context XML 里只渲句柄（renderTalkWindow/renderDoWindow 不内联 transcript）。
    // - 归属 **sub/peer 窗**（次要 attention）→ message 流只出**新消息提示**（非全文，指向该窗）；
    //   全文在该窗的 XML transcript 里渲一次。提示让 LLM 注意到"支路有新消息"，全文按需去窗里读。
    if (inboxMessage) {
      const windowId = resolveInboxWindowId(thread, inboxMessage);
      if (windowId) {
        const win = thread.contextWindows.find((w) => w.id === windowId);
        const isCreatorWin = !!win && isCreatorWindowId(win.id);
        if (win && !isCreatorWin) {
          const fromKey = inboxMessage.fromObjectId ?? inboxMessage.fromThreadId;
          // 次要 attention 缩略：window 收到新消息 + 正文前 50 字预览（全文在该窗 transcript）。
          const preview = (inboxMessage.content ?? "").replace(/\s+/g, " ").trim();
          const previewText = preview.length > 50 ? `${preview.slice(0, 50)}…` : preview;
          return [
            {
              type: "message",
              role: "system",
              content:
                `[context_change:inbox_message_arrived] msg_id=${event.msgId}` +
                (inboxMessage.source ? ` source=${inboxMessage.source}` : "") +
                (fromKey ? ` from=${fromKey}` : "") +
                ` window_id=${windowId} —— ${windowId} 收到新消息 "${previewText}"（次要 attention，全文见该 window 的 transcript）`,
            },
          ];
        }
      }
    }

    // header 行: KV 形式, 每个键只在有值时输出。
    // 关键 contract: header 与 body 之间用单个 \n 分隔 — claude-transport.ts 的
    // extractInboxContent 用第一个 \n 切分 header/body, 把 body 作为 user message,
    // 不要破坏这个边界。
    const headerParts = [`[context_change:${event.kind}] msg_id=${event.msgId}`];
    if (inboxMessage) {
      headerParts.push(`source=${inboxMessage.source}`);
      const fromKey = inboxMessage.fromObjectId ?? inboxMessage.fromThreadId;
      if (fromKey) {
        headerParts.push(`from=${fromKey}`);
      }
      const windowId = resolveInboxWindowId(thread, inboxMessage);
      if (windowId) {
        headerParts.push(`window_id=${windowId}`);
      }
    }
    const header = headerParts.join(" ");

    // body: inbox 消息正文(不截断, 与 talk_window level 0 渲染对齐);
    // 找不到 inbox 消息时(罕见, 防御性兜底)给 LLM 一条可读提示, 不抛错不打日志。
    let body: string;
    if (inboxMessage) {
      body = inboxMessage.content;
    } else {
      body = `(inbox message ${event.msgId} not found)`;
    }

    return [
      {
        type: "message",
        role: "system",
        content: `${header}\n${body}`,
      },
    ];
  }

  if (event.category === "context_change" && event.kind === "context_compressed") {
    // 压缩档位切换:silent-swallow ban 要求 LLM 能看见;以 system message 注入,
    // 简洁陈述档位变化 + 原因,不引入新协议(LLM 看到后可继续 / 也可 expand 回滚)。
    const target = event.windowIds.length > 0 ? event.windowIds.join(",") : "(events scope)";
    return [
      {
        type: "message",
        role: "system",
        content:
          `[context_change:context_compressed] ${event.levelChange} ` +
          `window_ids=${target} reason=${event.reason}` +
          (event.scope ? ` scope=${event.scope}` : ""),
      },
    ];
  }

  if (event.category === "context_change" && event.kind === "scheduler_yielded") {
    // worker 单次 runJob 跑满 workerMaxTicks 后自唤醒,LLM 下轮入口处看到本事件,
    // 知道自己被切片了(区别于 done/paused/failed)。
    const roundsTag = event.rounds !== undefined ? ` rounds=${event.rounds}` : "";
    return [
      {
        type: "message",
        role: "system",
        content: `[context_change:scheduler_yielded] reason=${event.reason}${roundsTag}`,
      },
    ];
  }

  if (event.category === "context_change" && event.kind === "events_summary") {
    // events 中段被折叠后的摘要节点:LLM 视野中替换被 _foldedBy 标记的原 events,
    // visibility-first 仍可见(否则就 silent-swallow 了)。
    const idTag = event.id ? ` id=${event.id}` : "";
    const earliest = event.earliestEventId ? ` earliest=${event.earliestEventId}` : "";
    const latest = event.latestEventId ? ` latest=${event.latestEventId}` : "";
    const quality = event.qualityHint ? ` quality=${event.qualityHint}` : "";
    const scope = event.scope ? ` scope=${event.scope}` : "";
    return [
      {
        type: "message",
        role: "system",
        content:
          `[context_change:events_summary count=${event.count}${idTag}${earliest}${latest}${quality}${scope}] ` +
          `${event.count} events folded, summary by LLM:\n${event.summary}`,
      },
    ];
  }

  if (event.category === "permission" && event.kind === "permission_ask") {
    // 渲染区分 pending / approved / rejected 三态;让 LLM 在 transcript 中看到完整审批历史。
    const windowTag = event.windowId ? ` window_id=${event.windowId}` : "";
    const argsTag = event.argsSummary ? `\n  args: ${event.argsSummary}` : "";
    const decided = event.decided;
    let statusLine: string;
    if (!decided) {
      statusLine = "  status: awaiting human approval; thread paused";
    } else if (decided.action === "approve") {
      statusLine = `  status: approved at ${decided.at}${decided.reason ? ` reason: ${decided.reason}` : ""}`;
    } else {
      statusLine = `  status: rejected at ${decided.at}${decided.reason ? ` reason: ${decided.reason}` : ""}`;
    }
    return [
      {
        type: "message",
        role: "system",
        content:
          `[permission:permission_ask] tool_call_id=${event.toolCallId} method=${event.method}${windowTag}` +
          `${argsTag}\n${statusLine}`,
      },
    ];
  }

  if (event.category === "permission" && event.kind === "permission_denied") {
    // deny 路径渲染 — 紧邻位置还会有一条合成的 function_call_output, 这里只补一条
    // 给 LLM 的 system 提示, 便于 LLM 在多步 reasoning 中识别拒绝。
    const windowTag = event.windowId ? ` window_id=${event.windowId}` : "";
    const argsTag = event.argsSummary ? `\n  args: ${event.argsSummary}` : "";
    return [
      {
        type: "message",
        role: "system",
        content:
          `[permission:permission_denied] tool_call_id=${event.toolCallId} method=${event.method}${windowTag}` +
          `\n  reason: ${event.reason}${argsTag}`,
      },
    ];
  }

  if (event.category === "context_change" && event.kind === "inject") {
    // 所有 inject 都进 transcript（silent-swallow ban）：包括 close 拒绝、deprecation 提醒、
    // [interrupted] 恢复提示、end.result 兜底说明等。文案语义由各写入点的前缀
    // ([错误] / [close 拒绝] / [interrupted] / [end.result] / [do] ...) 自带，render
    // 层不再做二次分类。
    //
    // 如果事件携带 observability 元数据 (source / errorCode / dataPreview)，
    // 也一并渲染出来——便于 LLM 自己解释哪里出错，也便于 timeline viewer 调试。
    const meta: string[] = [];
    if (event.source) meta.push(`source=${event.source}`);
    if (event.errorCode) meta.push(`errorCode=${event.errorCode}`);
    if (event.dataPreview) meta.push(`dataPreview=${event.dataPreview}`);
    const metaLine = meta.length > 0 ? `\n[meta] ${meta.join(", ")}` : "";
    return [
      {
        type: "message",
        role: "system",
        content: `[context_change:inject]\n${event.text}${metaLine}`,
      },
    ];
  }

  if (event.kind === "tool_use") {
    return [];
  }

  if (event.kind === "function_call") {
    return [
      {
        type: "function_call",
        call_id: event.callId,
        name: event.toolName,
        arguments: event.arguments
      }
    ];
  }

  if (event.category === "tool_runtime") {
    return [
      {
        type: "function_call_output",
        call_id: event.callId,
        name: event.toolName,
        output: event.output
      }
    ];
  }

  if (event.kind === "thinking") {
    return [];
  }

  // call_started 是 thinkloop 给 recovery 的磁盘锚点 (writeThread 之后即可被读到),
  // 对 LLM 视野无意义, 不进 transcript。详见 ProcessEvent.call_started + recovery.ts。
  if (event.category === "llm_interaction" && event.kind === "call_started") {
    return [];
  }

  return [
    {
      type: "message",
      role: "assistant",
      content: event.text
    }
  ];
}

// ── Peer window reconcile (per-round) ───────────────────────────────────────

/**
 * Returns true if the window looks like a peer Object window:
 * id === type (by ooc-6 Object window convention) and the type
 * is not a builtin Object id.
 */
function isPeerWindow(w: OocObjectInstance): boolean {
  if (w.id !== w.class) return false;
  if (isBuiltinObjectId(w.class)) return false;
  return true;
}

/**
 * Reconcile peer-style windows from the pipeline's derived snapshot into
 * the persisted thread.contextWindows. Idempotent — skips any id already
 * present. This runs per-round in buildInputItems so that newly discovered
 * peers (e.g. a child Object stone created mid-session) become immediately
 * exec-able without waiting for the next thread restart.
 */
function reconcilePeerWindowsIntoContext(
  thread: ThreadContext,
  snapshotWindows: readonly OocObjectInstance[],
): void {
  if (!snapshotWindows.length) return;
  const list = thread.contextWindows ?? (thread.contextWindows = []);
  const existing = new Set(list.map((w) => w.id));
  let appended = 0;
  for (const w of snapshotWindows) {
    if (!isPeerWindow(w)) continue;
    if (existing.has(w.id)) continue;
    list.push({ ...w });
    existing.add(w.id);
    appended++;
  }
  if (appended > 0) {
    thread.contextWindows = list;
  }
}

/**
 * 当本轮 context 估算（窗口 + transcript）超过 soft 阈值时，构造一条瞬时 system 警告。
 *
 * 仅影响本轮 LLM 输入，不进 thread.events。overflow（被 budget 排除的窗口）由
 * XmlRenderer 的 <context_overflow> 节点直接呈现，这里只补一条 soft 档提示，提示 LLM 主动精简：
 * 窗口可 `close`，但 transcript（历史叙事）不能 close、只能 `compress(scope=events)` 折叠
 * —— 故 transcript 占比高时显式指向该杠杆。
 */
function buildBudgetWarningItem(
  currentTokens: number,
  thresholds: BudgetThresholds,
  transcriptTokens: number,
): LlmInputItem {
  return {
    type: "message",
    role: "system",
    content:
      `<context_budget_warning current="${currentTokens}" transcript="${transcriptTokens}" soft="${thresholds.soft}" hard="${thresholds.hard}"/>\n` +
      `当前估算 token 接近预算上限 (current=${currentTokens}, 其中 transcript=${transcriptTokens}, soft=${thresholds.soft}, hard=${thresholds.hard})。` +
      `系统已按相关性把低相关窗口排除在 context 之外（见 <context_overflow>）。你可主动 ` +
      `close 不再需要的 window；历史叙事（transcript）占比高时用 exec(method="compress", args={scope:"events", keepTail:N, summary:"…"}) ` +
      `折叠早期过程，或继续推进任务。`,
  };
}

/**
 * 把 events 折叠区段**吸附到 tool-pair 安全边界**（events compress 读出侧，self 视角专用）。
 *
 * Case B：agent 主动折的任意区段若只覆盖一对 function_call / function_call_output 的一半，
 * 投影后会留下孤儿 tool 块——provider 层（claude-transport）不 sanitize，孤儿 tool_use/tool_result
 * 会被 LLM provider 拒、本轮 think 崩。这里在投影**前**把区段外扩到覆盖完整配对（两半要么都折、
 * 要么都留），从根上不产生孤儿。pending call（有 call 无 output，恢复期边界）不外扩、原样保留。
 *
 * 纯函数：只调整本轮投影用的 range，不改存储的 `win.summarizedRanges`（expand 仍按原 range 还原）。
 */
function snapRangesToToolPairs(
  events: ProcessEvent[],
  ranges: SummarizedRange[] | undefined,
): SummarizedRange[] | undefined {
  if (!ranges || ranges.length === 0) return ranges;
  const callIdx = new Map<string, number>();
  const outIdx = new Map<string, number>();
  events.forEach((e, i) => {
    if (e.kind === "function_call") callIdx.set(e.callId, i);
    else if (e.kind === "function_call_output") outIdx.set(e.callId, i);
  });
  // 两半都在场的配对（pending call 无 output → 不参与，故不会被外扩拉进折叠区段）。
  const pairs: Array<[number, number]> = [];
  for (const [cid, ci] of callIdx) {
    const oi = outIdx.get(cid);
    if (oi !== undefined) pairs.push([Math.min(ci, oi), Math.max(ci, oi)]);
  }
  if (pairs.length === 0) return ranges;
  const snapped = ranges.map((r) => {
    let fromIdx = r.fromIdx;
    let toIdx = r.toIdx;
    let changed = true;
    while (changed) {
      changed = false;
      for (const [lo, hi] of pairs) {
        const loIn = lo >= fromIdx && lo <= toIdx;
        const hiIn = hi >= fromIdx && hi <= toIdx;
        if (loIn !== hiIn) {
          // 区段只覆盖配对一半 → 外扩到覆盖另一半。
          if (lo < fromIdx) {
            fromIdx = lo;
            changed = true;
          }
          if (hi > toIdx) {
            toIdx = hi;
            changed = true;
          }
        }
      }
    }
    return { fromIdx, toIdx, summary: r.summary };
  });
  // 外扩可能让相邻/重叠区段相交 → normalize 合并去重。
  return normalizeSummarizedRanges(snapped);
}

/** 构造 Responses-first LLM 输入 items。 */
export async function buildInputItems(
  thread: ThreadContext
): Promise<{ instructions?: string; input: LlmInputItem[] }> {
  // ContextPipeline + XmlRenderer production path
  const pipeline = createDefaultPipeline();
  const snapshot = await pipeline.run(thread);

  // peer-window reconcile: any peer-style window the pipeline derived
  // (id = type = objectId, type not a builtin window/Object type) that is
  // missing from thread.contextWindows gets persisted now. This guarantees
  // exec() → WindowManager.fromThread → requireParent succeeds for peer
  // windows even if initContextWindows ran before the stone hierarchy was
  // populated (dynamic child creation, etc.). Idempotent.
  reconcilePeerWindowsIntoContext(thread, snapshot.windows);

  const renderer = new XmlRenderer();
  const content = await renderer.render(snapshot, thread);

  // Observability mirror: stash the pipeline's actually-rendered window set
  // (base + derived: protocol/activator knowledge, peer Objects, form knowledge)
  // so finishLlmLoop's windowsSnapshot reflects what the LLM saw, not just the
  // persisted thread.contextWindows (which omits all derived windows). Transient,
  // never persisted. See _shared/types/thread.ts:_renderedWindows.
  thread._renderedWindows = snapshot.windows;

  // self 视角 transcript：thread.events 平铺成 message 流，按 self 窗投影态 win 的
  // summarizedRanges 折叠——落在某段内的连续 events 替换为一条 summary 占位，段外正常渲。
  // 折叠态视角独立（存 self 窗 win，不改 thread.events），可逆。events compress 读出侧。
  // （旧 _foldedBy/events_summary 脚手架保留为 auto 兜底休眠路径：renderItem 内仍跳过 _foldedBy。）
  const selfWin = thread.contextWindows?.find(
    (w) => (w.win as { isSelfWindow?: boolean } | undefined)?.isSelfWindow === true,
  )?.win as { summarizedRanges?: SummarizedRange[] } | undefined;
  const transcript = projectSummarizedRanges<ProcessEvent, LlmInputItem>(
    thread.events,
    // 投影前把区段吸附到 tool-pair 安全边界（Case B：防折叠切断 function_call/output 配对留孤儿）。
    snapRangesToToolPairs(thread.events, selfWin?.summarizedRanges),
    (event) => (event._foldedBy ? [] : processEventToItems(thread, event)),
    (range, foldedCount) => [
      {
        type: "message",
        role: "system",
        content:
          `[context_change:events_summary count=${foldedCount} ` +
          `range=${range.fromIdx}-${range.toIdx} scope=events] ` +
          `${foldedCount} events folded, summary by LLM:\n${range.summary}`,
      },
    ],
  );

  // self.md 身份不再单独灌进 system instructions——它作为 self 窗的 self 视角内容渲进 context
  // （resolveProjection：self 视角渲 self.md、peer 视角渲 readable.md）。身份只活在 self 窗这一处。

  // [ooc:paths] meta node for metaprogramming / path anchors
  const pathsItem = await buildPathsItem(thread);

  // Budget soft-warning: 预算分配由 pipeline.run 唯一负责（snapshot.windows 即 in-budget
  // 集合，overflow 由 renderer 的 <context_overflow> 呈现）。这里只在 context 估算仍超 soft
  // 阈值时补一条瞬时警告，紧跟 XML context message 之后，使 LLM 看到 context 即看到提示。
  // current = 窗口估算 + transcript 估算（context.md 核心 10：transcript 是自己视角 thread window
  // 的内容通道、走 message 流，与窗口一并计入预算账——否则 events append-only 无界增长却不报警）。
  const thresholds = loadBudgetThresholds(thread);
  const windowsTokens = estimateWindowsTokens(snapshot.windows);
  const transcriptTokens = estimateTranscriptTokens(transcript);
  const currentTokens = windowsTokens + transcriptTokens;

  // 应急兜底（emergency_guard）：current 越 hard 时，把 transcript 钳到 (hard - 窗口估算) 内
  // ——丢最早、留最近、tool-pair 安全（transcript-clamp.ts）。与窗 overflow 同模型：per-round、
  // 瞬态、不改 thread.events、不动 win、不持久化、不生成摘要。插一条可见 marker 指向 compress
  // （silent-swallow ban）。这是安全网，agent 仍应主动 compress 持久折叠。
  let renderedTranscript = transcript;
  let clampMarker: LlmInputItem[] = [];
  if (currentTokens > thresholds.hard) {
    const transcriptBudget = Math.max(thresholds.hard - windowsTokens, 0);
    const { kept, omittedCount } = clampTranscriptToBudget(transcript, transcriptBudget);
    if (omittedCount > 0) {
      renderedTranscript = kept;
      clampMarker = [
        {
          type: "message",
          role: "system",
          content:
            `[context_change:context_clamped] 最早 ${omittedCount} 条 transcript 项本轮被省略以适配预算 ` +
            `(current≈${currentTokens} > hard=${thresholds.hard})。完整历史仍在 thread.events（未丢失）；` +
            `用 exec(method="compress", args={scope:"events", keepTail:N, summary:"…"}) 持久折叠早期过程。`,
        },
      ];
    }
  }

  const budgetWarning =
    currentTokens > thresholds.soft
      ? [buildBudgetWarningItem(currentTokens, thresholds, transcriptTokens)]
      : [];

  return {
    input: [
      {
        type: "message",
        role: "system",
        content
      },
      ...budgetWarning,
      ...(pathsItem ? [pathsItem] : []),
      ...clampMarker,
      ...renderedTranscript
    ]
  };
}

/**
 * 构造 [ooc:paths] system message。
 *
 * 把以下绝对路径告诉 LLM(每轮都注入,作为元编程 / 路径引用的稳定锚点):
 * - world_root:               OOC world 根目录(stones / flows 等所有子树的父目录)
 * - object_stone_dir:         本 Object 的 stone 目录(身份 / 知识 / server / client 长期存放)
 * - object_flow_dir:          本 Object 在当前 session 下的 flow 目录(临时产出 / 本次任务文件)
 * - current_thread_dir:       当前 thread 的 thread.json 所在目录(debug / loop_*.json 在这里)
 * - session_id / object_id / thread_id:  人类可读的标识
 *
 * 之所以放在 system message 而非 instructions:每轮都需要稳定看到、不被对话历史挤占;
 * 用 system role 与 XML context message 平行 — 都属于"环境信息"。
 */
async function buildPathsItem(thread: ThreadContext): Promise<LlmInputItem | undefined> {
  const ref = thread.persistence;
  if (!ref) return undefined;
  // worktree 模型：object_stone_dir 与 program shell $OOC_SELF_DIR 同源——business
  // session 命中 worktree（已建）时显示 flows/<sid>/objects/<id>/，否则 main。
  // 用 "read" 模式：被动每轮注入不应主动建 worktree（惰性，仅首次 identity 写才建）。
  const stoneRef = await resolveStoneIdentityRef(
    { baseDir: ref.baseDir, sessionId: ref.sessionId, objectId: ref.objectId },
    "read",
  );
  const lines = [
    "[ooc:paths]",
    `world_root: ${ref.baseDir}`,
    `object_id: ${ref.objectId}`,
    `object_stone_dir: ${stoneDir(stoneRef)}`,
    `object_flow_dir: ${objectDir(ref)}`,
    `session_id: ${ref.sessionId}`,
    `current_thread_id: ${ref.threadId}`,
    `current_thread_dir: ${threadDir(ref)}`,
  ];
  return {
    type: "message",
    role: "system",
    content: lines.join("\n"),
  };
}

