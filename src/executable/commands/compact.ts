import { consola } from "consola";
import { applyCompact, estimateActionsTokens } from "../../thread/compact.js";
import type { ThreadDataFile } from "../../thread/types.js";
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
    td.actions.push({
      type: "inject",
      content: `[错误] submit compact 必须带 summary 参数（LLM 生成的浓缩摘要纯文本）。本次压缩未执行。`,
      timestamp: Date.now(),
    });
    ctx.tree.writeThreadData(ctx.threadId, td);
    return;
  }

  const marks = td.compactMarks ?? {};
  const before = estimateActionsTokens(td.actions);
  const newActions = applyCompact(td.actions, marks, summary);
  const after = estimateActionsTokens(newActions);
  const dropCount = marks.drops?.length ?? 0;
  const truncateCount = marks.truncates?.length ?? 0;
  const summaryAction = newActions[0]!;
  const nextTd: ThreadDataFile = {
    ...td,
    actions: newActions,
    compactMarks: undefined,
  };
  nextTd.actions.push({
    type: "inject",
    content:
      `>>> [compact 完成] drop=${dropCount} truncate=${truncateCount}; ` +
      `tokens ${before} → ${after}（节省 ${before - after}）。\n` +
      `compact_summary 已作为首条历史背景注入，后续工作继续。`,
    timestamp: Date.now(),
  });
  ctx.tree.writeThreadData(ctx.threadId, nextTd);
  consola.info(`[Engine] compact: tokens ${before} → ${after} drop=${dropCount} truncate=${truncateCount} kept=${summaryAction.kept}`);
}
