/**
 * 线程上下文压缩 —— 核心算法
 *
 * 负责：
 * - token 估算（简单 `JSON.stringify(events).length / 4`）
 * - preview：根据 compactMarks 预估压缩后 token 数
 * - apply：真正执行压缩，返回新的 process events 数组 + compact_summary
 *
 * 对外暴露给 engine 的 compact 提交分支与 compact trait 的 preview 方法。
 *
 * 设计约束：
 * - 纯函数：输入 process events + marks，输出新 events；不 IO、不修改入参
 * - 不依赖 ThreadsTree：engine 负责持久化回写
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_context_compact.md
 */

import type { ProcessEvent, ThreadDataFile } from "../thread-tree/types.js";

/**
 * 默认 token 阈值：超过此值时 engine 在 context 末尾注入"建议 compact"提示
 *
 * 选 60k 是经验值：Claude Sonnet 的有效注意力窗口对 60k+ token 开始退化；
 * 同时 60k 远低于 200k 上限，留足空间让 LLM 完成 compact 本身的工作。
 */
export const COMPACT_THRESHOLD_TOKENS = 60_000;

/**
 * 估算 process events 数组的 token 数
 *
 * 简化策略：`JSON.stringify(events).length / 4`
 * - 英文 ~4 字符/token，中文 ~1.5 字符/token，平均 ~3 字符/token
 * - 除以 4 是偏保守估算（会低估中文占比高的 context，但不至于漏掉真正超阈值的场景）
 * - 不引入 tiktoken（增加依赖 + 跨平台麻烦 + 对估算目标"是否需要 compact"精度足够）
 */
export function estimateEventsTokens(events: ProcessEvent[]): number {
  if (events.length === 0) return 0;
  return Math.floor(JSON.stringify(events).length / 4);
}

/** compactMarks 的别名（从 ThreadDataFile 提取，方便类型签名简洁） */
export type CompactMarks = NonNullable<ThreadDataFile["compactMarks"]>;

/**
 * 对单条 process event 应用截断标记
 *
 * 只截断 content / result / args.*（如果存在长文本 string 字段）。timestamp / type / id / name 保持不变。
 * maxLines 单位是"内容行数"——按 `\n` split 后取前 N 行。
 */
function truncateEventContent(event: ProcessEvent, maxLines: number): ProcessEvent {
  if (maxLines <= 0) return event;
  const next: ProcessEvent = { ...event };
  if (typeof next.content === "string" && next.content.length > 0) {
    const lines = next.content.split("\n");
    if (lines.length > maxLines) {
      next.content = `${lines.slice(0, maxLines).join("\n")}\n... (共 ${lines.length} 行，compact 截断到前 ${maxLines} 行)`;
    }
  }
  if (typeof next.result === "string" && next.result.length > 0) {
    const lines = next.result.split("\n");
    if (lines.length > maxLines) {
      next.result = `${lines.slice(0, maxLines).join("\n")}\n... (共 ${lines.length} 行，compact 截断到前 ${maxLines} 行)`;
    }
  }
  return next;
}

/**
 * 预估应用 marks 后的 token 数（不真正改 events）
 *
 * 用于 compact.preview_compact——让 LLM 在 submit 前看一眼效果。
 */
export function previewCompactedTokens(events: ProcessEvent[], marks: CompactMarks): number {
  const result = applyMarks(events, marks);
  return estimateEventsTokens(result);
}

/**
 * 应用 compactMarks：返回新 process events 数组（不含 compact_summary，由调用方追加）
 *
 * 处理顺序：
 * 1. drops 优先级高于 truncates——同一 idx 上两者都标记时走 drop
 * 2. 保留原 events 的相对顺序
 * 3. 非标记的 event 原样保留
 */
export function applyMarks(events: ProcessEvent[], marks: CompactMarks): ProcessEvent[] {
  const dropSet = new Set((marks.drops ?? []).map(d => d.idx));
  const truncateMap = new Map<number, number>();
  for (const t of marks.truncates ?? []) truncateMap.set(t.idx, t.maxLines);

  const result: ProcessEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    if (dropSet.has(i)) continue;
    const event = events[i]!;
    const maxLines = truncateMap.get(i);
    result.push(maxLines !== undefined ? truncateEventContent(event, maxLines) : event);
  }
  return result;
}

/**
 * 执行完整压缩：应用 marks + 插入 compact_summary 作为首条
 *
 * @param events - 原 process events 数组（变量名保留 events 以兼容 compact marks 的 idx 语义）
 * @param marks - 待应用的压缩标记
 * @param summary - LLM 生成的压缩摘要纯文本
 * @returns 新的 process events 数组（含 compact_summary 作为首条）
 *
 * compact_summary 的 timestamp 被强制设为 min(原 event.timestamp) - 1，保证永远排在最前。
 * 若原 events 为空（理论不会发生），退化为当前时间。
 */
export function applyCompact(
  events: ProcessEvent[],
  marks: CompactMarks,
  summary: string,
): ProcessEvent[] {
  const original = events.length;
  const compacted = applyMarks(events, marks);
  const kept = compacted.length;

  /* compact_summary 的 timestamp：取原 events 最小 ts - 1（或者兜底 Date.now()） */
  const minTs = events.length > 0
    ? events.reduce((m, a) => Math.min(m, a.timestamp), Infinity)
    : Date.now();
  const summaryTs = isFinite(minTs) ? minTs - 1 : Date.now();

  const summaryEvent: ProcessEvent = {
    type: "compact_summary",
    content: summary,
    timestamp: summaryTs,
    original,
    kept,
  };

  return [summaryEvent, ...compacted];
}

/**
 * 生成"建议 compact"系统提示（engine 在 context 末尾注入）
 *
 * @param currentTokens - 当前估算的 token 数
 * @param threshold - 阈值（默认 COMPACT_THRESHOLD_TOKENS）
 * @returns 提示文本（含完整 open/refine/submit JSON 引导）
 */
export function buildCompactHint(
  currentTokens: number,
  threshold: number = COMPACT_THRESHOLD_TOKENS,
): string {
  const kTokens = Math.floor(currentTokens / 1000);
  return (
    `\n<!-- compact-pressure-hint -->\n` +
    `>>> [系统提示] 当前线程 process events 已占用 ~${kTokens}k tokens（阈值 ${Math.floor(threshold / 1000)}k），接近压力区。\n` +
    `建议先进入 compact 模式：open({"title":"压缩上下文","type":"command","command":"compact","description":"梳理当前线程历史并压缩冗余 events"})。\n` +
    `进入后优先使用直接 trait method：open({"title":"列出可压缩 events","type":"command","command":"program","trait":"kernel:compact","method":"list_actions","description":"查看可压缩 events"})，随后 submit({"form_id":"..."}) 执行。\n` +
    `完成标记后用 submit({"form_id":"<compact form id>","summary":"此前：... 当前：..."}) 应用压缩并退出。`
  );
}
