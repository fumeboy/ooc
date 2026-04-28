import { consola } from "consola";
import { applyCompact, estimateEventsTokens } from "../../thinkable/context/compact.js";
import type { ThreadDataFile } from "../../thinkable/thread-tree/types.js";
import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export const compactCommand: CommandTableEntry = {
  paths: ["compact"],
  match: () => ["compact"],
  openable: true,
};

export function executeCompactCommand(ctx: CommandExecutionContext): void {
  const summary = typeof ctx.args.summary === "string" ? ctx.args.summary.trim() : "";
  const td = ctx.tree.readThreadData(ctx.threadId);
  if (!td) {
    consola.warn(`[Engine] compact: 读取 thread.json 失败 thread=${ctx.threadId}`);
    return;
  }
  if (summary.length === 0) {
    td.events.push({
      type: "inject",
      content: `[错误] submit compact 必须带 summary 参数（LLM 生成的浓缩摘要纯文本）。本次压缩未执行。`,
      timestamp: Date.now(),
    });
    ctx.tree.writeThreadData(ctx.threadId, td);
    return;
  }

  const marks = td.compactMarks ?? {};
  const before = estimateEventsTokens(td.events);
  const newEvents = applyCompact(td.events, marks, summary);
  const after = estimateEventsTokens(newEvents);
  const dropCount = marks.drops?.length ?? 0;
  const truncateCount = marks.truncates?.length ?? 0;
  const summaryEvent = newEvents[0]!;
  const nextTd: ThreadDataFile = {
    ...td,
    events: newEvents,
    compactMarks: undefined,
  };
  nextTd.events.push({
    type: "inject",
    content:
      `>>> [compact 完成] drop=${dropCount} truncate=${truncateCount}; ` +
      `tokens ${before} → ${after}（节省 ${before - after}）。\n` +
      `compact_summary 已作为首条历史背景注入，后续工作继续。`,
    timestamp: Date.now(),
  });
  ctx.tree.writeThreadData(ctx.threadId, nextTd);
  consola.info(`[Engine] compact: tokens ${before} → ${after} drop=${dropCount} truncate=${truncateCount} kept=${summaryEvent.kept}`);
}
