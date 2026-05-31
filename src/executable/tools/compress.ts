/**
 * compress tool — OOC 上下文压缩主动入口。
 *
 * Design: docs/2026-05-25-context-compression-design.md §4.5
 *
 * 形态:
 *   compress(scope: "windows" | "events" | "auto",
 *            target_ids?, level?,
 *            summary?, target_event_ids?)
 *
 * 已实现路径:
 *   - scope="windows" (P0b): 切 ContextWindow.compressLevel,落 context_compressed 事件。
 *   - scope="events"  (P0f): 把 events 中段标 _foldedBy,落一条 events_summary +
 *                            一条 context_compressed (reason="user-events-fold")。
 * 未实现:
 *   - scope="auto": 留给 P0e emergency_guard。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext, ProcessEvent } from "../../thinkable/context.js";
import type { ContextWindow } from "../windows/_shared/types.js";
import { deriveStoneFromThread, stoneDir } from "../../persistable/common.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

export const COMPRESS_TOOL: LlmTool = {
  name: "compress",
  description:
    "主动压缩 thread 上的 context 单元,降低 LLM 视野中的 token 占用。" +
    "scope=\"windows\": 给定 target_ids(window id 列表)将这些 window 切到 " +
    "compressLevel=1(folded) 或 2(snapshot),压缩态 window 自动获得 expand 命令可恢复。" +
    "scope=\"events\": 把 events 中段折叠为一条 events_summary;summary 由 LLM 提供;" +
    "未指定 target_event_ids 时默认保留 head_ring (J=10) + tail_ring (K=40),其余 fold。" +
    "scope=\"auto\" 暂未实现(留给 emergency_guard)。" +
    "每次压缩都会写一条 context_compressed 事件进 thread.events,LLM 后续轮次可见。",
  inputSchema: {
    type: "object",
    properties: {
      title: TITLE_PARAM,
      scope: {
        type: "string",
        enum: ["windows", "events", "auto"],
        description:
          "压缩目标:windows(指定 window 折叠) / events(事件流摘要) / auto(系统按 budget 自动决策,暂未实现)",
      },
      target_ids: {
        type: "array",
        items: { type: "string" },
        description: "scope=windows 时要压缩的 window id 列表",
      },
      level: {
        type: "number",
        enum: [1, 2],
        description: "压缩档位:1=folded(保留 title + 摘要),2=snapshot(仅元信息);默认 1",
      },
      summary: {
        type: "string",
        description: "scope=events 时由 LLM 提供的摘要文本(必填)",
      },
      target_event_ids: {
        type: "array",
        items: { type: "string" },
        description:
          "scope=events 时可选;若指定则按该 id 列表 fold,必须为连续区段(在 thread.events 中位置相邻);" +
          "不指定则按 head/tail ring 默认折叠中段。",
      },
      quality_hint: {
        type: "string",
        enum: ["rough", "curated"],
        description: "scope=events 时可选;LLM 自评 summary 质量。",
      },
      mark: MARK_PARAM,
    },
    required: ["scope"],
  },
};

const successOutput = (message: string, extra?: Record<string, unknown>) =>
  JSON.stringify({ ok: true, tool: "compress", message, ...(extra ?? {}) });
const errorOutput = (error: string) =>
  JSON.stringify({ ok: false, tool: "compress", error });

// ─────────────────────────── scope=windows ────────────────────────────────────

/** 提取 args.target_ids 为 string[];非法形态返回 []。 */
function getTargetIds(args: Record<string, unknown>): string[] {
  const raw = args.target_ids ?? args.targetIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

/** 提取 args.target_event_ids 为 string[];非法形态返回 []。 */
function getTargetEventIds(args: Record<string, unknown>): string[] {
  const raw = args.target_event_ids ?? args.targetEventIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

/** 归一化 level 到 1 | 2;非法 / 缺省退化到 1。 */
function normalizeLevel(args: Record<string, unknown>): 1 | 2 {
  const raw = args.level;
  if (raw === 2 || raw === "2") return 2;
  return 1;
}

/**
 * 执行 scope=windows 压缩:对 thread.contextWindows 中匹配 target_ids 的 window
 * 不可变地写回 compressLevel,并写一条聚合的 context_compressed 事件。
 *
 * 返回字段:
 * - changed         : 实际切档的 window id 集合
 * - missing         : target_ids 中找不到对应 window 的 id 集合
 * - alreadyAtLevel  : 已经处于目标 level,无需切的 window id
 * - rejected        : 类型上不允许压缩 (root / command_exec) 的 window id
 */
function compressWindowsClean(
  thread: ThreadContext,
  targetIds: string[],
  level: 1 | 2,
): { changed: string[]; missing: string[]; alreadyAtLevel: string[]; rejected: string[] } {
  const changed: string[] = [];
  const missing: string[] = [];
  const alreadyAtLevel: string[] = [];
  const rejected: string[] = [];

  const idSet = new Set(targetIds);
  const existingIds = new Set((thread.contextWindows ?? []).map((w) => w.id));
  for (const id of targetIds) {
    if (!existingIds.has(id)) missing.push(id);
  }

  const oldLevels = new Map<string, 0 | 1 | 2>();
  const next: ContextWindow[] = (thread.contextWindows ?? []).map((window) => {
    if (!idSet.has(window.id)) return window;
    const current = (window.compressLevel ?? 0) as 0 | 1 | 2;
    if (current === level) {
      alreadyAtLevel.push(window.id);
      return window;
    }
    if (window.type === "root" || window.type === "command_exec") {
      rejected.push(window.id);
      return window;
    }
    oldLevels.set(window.id, current);
    changed.push(window.id);
    return { ...window, compressLevel: level } as ContextWindow;
  });
  thread.contextWindows = next;

  if (changed.length > 0) {
    // levelChange: 多 window 时若旧 level 全相同则精确表达,否则 "*"
    const uniqueOld = new Set(oldLevels.values());
    const fromLabel = uniqueOld.size === 1 ? String([...uniqueOld][0]) : "*";
    const event: ProcessEvent = {
      category: "context_change",
      kind: "context_compressed",
      windowIds: changed,
      levelChange: `${fromLabel}→${level}`,
      reason: "user-compress",
      scope: "windows",
    };
    thread.events.push(event);
  }

  return { changed, missing, alreadyAtLevel, rejected };
}

// ─────────────────────────── scope=events ─────────────────────────────────────

/** events ring 配置 (P0f F3); 缺失字段用默认值。 */
export interface EventsRingConfig {
  /** head ring 长度: 保留最早 J 条 event 不 fold。 */
  headRoundsJ: number;
  /** tail ring 长度: 保留最近 K 条 event 不 fold。 */
  tailRoundsK: number;
}

export const DEFAULT_EVENTS_RING_CONFIG: EventsRingConfig = {
  headRoundsJ: 10,
  tailRoundsK: 40,
};

/** 把 stone 上的 context-budget.json 中的 eventsRing 块读出来; 失败 fallback 到默认值。 */
export function loadEventsRingConfig(thread: ThreadContext): EventsRingConfig {
  if (!thread.persistence) return DEFAULT_EVENTS_RING_CONFIG;
  let configPath: string;
  try {
    const stoneRef = deriveStoneFromThread(thread.persistence);
    configPath = join(stoneDir(stoneRef), "config", "context-budget.json");
  } catch {
    return DEFAULT_EVENTS_RING_CONFIG;
  }
  if (!existsSync(configPath)) return DEFAULT_EVENTS_RING_CONFIG;
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as {
      eventsRing?: Partial<EventsRingConfig>;
    };
    const er = parsed?.eventsRing ?? {};
    return {
      headRoundsJ:
        typeof er.headRoundsJ === "number" && er.headRoundsJ > 0
          ? er.headRoundsJ
          : DEFAULT_EVENTS_RING_CONFIG.headRoundsJ,
      tailRoundsK:
        typeof er.tailRoundsK === "number" && er.tailRoundsK > 0
          ? er.tailRoundsK
          : DEFAULT_EVENTS_RING_CONFIG.tailRoundsK,
    };
  } catch {
    return DEFAULT_EVENTS_RING_CONFIG;
  }
}

/** 简易稳定 event id 生成器: 用 timestamp + index + counter。 */
let _summaryCounter = 0;
function generateSummaryEventId(): string {
  _summaryCounter += 1;
  return `e_sum_${Date.now().toString(36)}_${_summaryCounter}`;
}

/**
 * 决定哪些 events 应被 fold (按 index 返回连续区间 [startIdx, endIdx))。
 *
 * 选 index 而不是 id:
 * - target_event_ids 路径下用 id → index 映射后校验连续
 * - 默认路径下直接按位置切 head/tail
 */
function resolveFoldRange(
  events: ProcessEvent[],
  cfg: EventsRingConfig,
  targetEventIds: string[],
): { ok: true; startIdx: number; endIdx: number } | { ok: false; error: string } {
  if (targetEventIds.length > 0) {
    // 解析每个 id 对应的 index; 缺失 id → 报错
    const indices: number[] = [];
    for (const id of targetEventIds) {
      const idx = events.findIndex((e) => e.id === id);
      if (idx < 0) {
        return { ok: false, error: `target_event_ids 中的 id="${id}" 在 thread.events 中找不到。` };
      }
      indices.push(idx);
    }
    indices.sort((a, b) => a - b);
    // 检查连续 (相邻 index 差 1)
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] !== indices[i - 1] + 1) {
        return {
          ok: false,
          error: `target_event_ids 必须是连续区段;在 events 数组中 index=${indices[i - 1]} 与 index=${indices[i]} 不相邻。`,
        };
      }
    }
    return { ok: true, startIdx: indices[0], endIdx: indices[indices.length - 1] + 1 };
  }
  // 默认: head[0..J) + tail[len-K..len),中段[J..len-K) 被 fold
  const total = events.length;
  const head = cfg.headRoundsJ;
  const tail = cfg.tailRoundsK;
  const startIdx = head;
  const endIdx = total - tail;
  if (endIdx <= startIdx) {
    return {
      ok: false,
      error: `当前 events 数量 (${total}) 未超过 head(${head}) + tail(${tail}) 容量;无中段可 fold。`,
    };
  }
  return { ok: true, startIdx, endIdx };
}

/**
 * 执行 scope=events 压缩:
 * 1. 校验 summary 非空
 * 2. 决定 fold 范围(target_event_ids 优先,否则默认中段)
 * 3. 给被 fold 区段的 events 标 _foldedBy=<summary event id>
 * 4. 插入一条 events_summary event (放在被 fold 区段末尾之后,保证 LLM 看到的顺序自然)
 * 5. 落一条 context_compressed event (reason="user-events-fold", windowIds=[], scope="events")
 */
function compressEventsClean(
  thread: ThreadContext,
  args: Record<string, unknown>,
): { ok: true; result: Record<string, unknown> } | { ok: false; error: string } {
  const summaryRaw = args.summary;
  if (typeof summaryRaw !== "string" || summaryRaw.trim().length === 0) {
    return { ok: false, error: "compress(scope=events) 缺少非空 summary 参数(string)。" };
  }
  const summary = summaryRaw;

  const cfg = loadEventsRingConfig(thread);
  const targetEventIds = getTargetEventIds(args);
  const events = thread.events ?? [];

  const range = resolveFoldRange(events, cfg, targetEventIds);
  if (!range.ok) return { ok: false, error: range.error };

  const { startIdx, endIdx } = range;

  // 生成 summary event 的稳定 id 与 earliest/latest 锚点。
  const summaryId = generateSummaryEventId();
  const earliestEventId = events[startIdx]?.id;
  const latestEventId = events[endIdx - 1]?.id;

  // 标记被 fold 区段 (immutable: 整个 events 数组重建)。
  const foldedIndices = new Set<number>();
  for (let i = startIdx; i < endIdx; i++) foldedIndices.add(i);

  const newEvents: ProcessEvent[] = events.map((e, idx) => {
    if (foldedIndices.has(idx)) {
      return { ...e, _foldedBy: summaryId };
    }
    return e;
  });

  const summaryEvent: ProcessEvent = {
    id: summaryId,
    category: "context_change",
    kind: "events_summary",
    count: endIdx - startIdx,
    earliestEventId,
    latestEventId,
    summary,
    qualityHint:
      args.quality_hint === "curated" || args.quality_hint === "rough"
        ? (args.quality_hint as "curated" | "rough")
        : undefined,
    scope: "user",
  };

  const compressedEvent: ProcessEvent = {
    category: "context_change",
    kind: "context_compressed",
    windowIds: [],
    levelChange: "events-fold",
    reason: "user-events-fold",
    scope: "events",
  };

  // 把 summary 插入到 fold 区段结束位置 (endIdx 之后),保持 head + summary + tail 顺序;
  // compressed 事件追加在尾部 (visibility-first event,自然属于"最近")。
  const before = newEvents.slice(0, endIdx);
  const after = newEvents.slice(endIdx);
  thread.events = [...before, summaryEvent, ...after, compressedEvent];

  return {
    ok: true,
    result: {
      summary_event_id: summaryId,
      folded_count: endIdx - startIdx,
      folded_range: { start_index: startIdx, end_index: endIdx },
      head_ring: cfg.headRoundsJ,
      tail_ring: cfg.tailRoundsK,
      earliest_event_id: earliestEventId,
      latest_event_id: latestEventId,
    },
  };
}

// ─────────────────────────── 入口 ──────────────────────────────────────────────

export async function handleCompressTool(
  thread: ThreadContext,
  args: Record<string, unknown>,
): Promise<string> {
  const scope = args.scope as string | undefined;
  if (!scope) {
    return errorOutput("compress 缺少 scope 参数(windows | events | auto)。");
  }

  if (scope === "auto") {
    return errorOutput(
      `compress: scope="auto" not implemented yet (留给 P0e emergency_guard)。`,
    );
  }

  if (scope === "events") {
    const r = compressEventsClean(thread, args);
    if (!r.ok) return errorOutput(r.error);
    const { folded_count, summary_event_id } = r.result as {
      folded_count: number;
      summary_event_id: string;
    };
    return successOutput(
      `已折叠 ${folded_count} 条 events 为 summary (id=${summary_event_id})。`,
      r.result,
    );
  }

  if (scope !== "windows") {
    return errorOutput(`compress: 未知 scope "${scope}",合法值: windows | events | auto。`);
  }

  const targetIds = getTargetIds(args);
  if (targetIds.length === 0) {
    return errorOutput("compress(scope=windows) 缺少 target_ids 参数(string[])。");
  }
  const level = normalizeLevel(args);

  const result = compressWindowsClean(thread, targetIds, level);

  if (result.changed.length === 0) {
    // 检测 missing 中的 synthetic id 模式 — 给 LLM 解释为什么这些 id 看见但 compress 不到
    // (synthetic windows 由 synthesizer 每轮 derive,不在 thread.contextWindows 持久化)
    const syntheticMissing = result.missing.filter(
      (id) => id === "w_skill_index" || id.startsWith("w_skill_"),
    );
    const syntheticHint =
      syntheticMissing.length > 0
        ? `\n注意: ${syntheticMissing.length} 个 missing id 是 synthetic window (每轮由 synthesizer 重新派生,不持久化到 thread.contextWindows),无法被 compress 命中:\n` +
          `  ${syntheticMissing.slice(0, 5).join(", ")}${syntheticMissing.length > 5 ? ", ..." : ""}\n` +
          `skill_index_window 由 skills 索引派生,改 stone 配置间接收敛。`
        : "";
    return errorOutput(
      `compress: 无 window 实际被压缩 (missing=${result.missing.length}, alreadyAtLevel=${result.alreadyAtLevel.length}, rejected=${result.rejected.length})。` +
        (result.rejected.length > 0
          ? ` 被拒绝的 window 类型不允许压缩 (root / command_exec): ${result.rejected.join(",")}`
          : "") +
        syntheticHint,
    );
  }

  return successOutput(
    `已将 ${result.changed.length} 个 window 压缩到 level=${level}; 未生效: missing=${result.missing.length} alreadyAtLevel=${result.alreadyAtLevel.length} rejected=${result.rejected.length}`,
    {
      changed: result.changed,
      missing: result.missing,
      already_at_level: result.alreadyAtLevel,
      rejected: result.rejected,
      level,
    },
  );
}
