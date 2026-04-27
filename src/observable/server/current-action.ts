import type { Action, Process, ProcessNode } from "../../shared/types/index.js";

/**
 * 动态摘要最大字符长度（超过截断追加省略号）
 *
 * 与迭代文档 `docs/工程管理/迭代/all/20260422_feature_running_session_摘要.md`
 * 约定的"限长 50 字符"对齐。
 */
const CURRENT_ACTION_MAX_LEN = 50;

/**
 * 从 Process 计算一句话"当前动作"摘要
 *
 * 仅用于 running session 在前端（SessionKanban）做"正在做什么"的动态提示。
 */
export function computeCurrentAction(process: Process | undefined | null): string | undefined {
  if (!process?.root) return undefined;

  const all: Action[] = [];
  const walk = (node: ProcessNode): void => {
    for (const a of node.actions ?? []) all.push(a);
    for (const child of node.children ?? []) walk(child);
  };
  walk(process.root);

  if (all.length === 0) return undefined;

  const sorted = [...all].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  const latestThinking = sorted.find((a) => a.type === "thinking" && typeof a.content === "string" && a.content.trim().length > 0);
  if (latestThinking) {
    const firstLine = latestThinking.content.split(/\r?\n/)[0]!.trim();
    if (firstLine) return truncate(firstLine, CURRENT_ACTION_MAX_LEN);
  }

  const latestToolUse = sorted.find((a) => a.type === "tool_use" && typeof a.title === "string" && a.title.trim().length > 0);
  if (latestToolUse && latestToolUse.title) {
    return truncate(latestToolUse.title.trim(), CURRENT_ACTION_MAX_LEN);
  }

  const latest = sorted[0];
  if (latest) {
    const label = latest.name && latest.name.trim() ? latest.name.trim() : latest.type;
    return truncate(label, CURRENT_ACTION_MAX_LEN);
  }

  return undefined;
}

/** 截断到 max 字符，超出补 `…`（不折中英文，简化实现） */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}
