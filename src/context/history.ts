/**
 * 历史 Flow 摘要加载器
 *
 * 加载最近 N 个 flow 的摘要，供 context 注入，实现跨 flow 记忆。
 * 只读取有 summary 字段的 flow，跳过无摘要的。
 *
 * @ref docs/哲学文档/gene.md#G5 — implements — 跨 flow 记忆注入 context
 * @ref src/persistence/reader.ts — references — listFlowSessions, readFlow
 */

import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { listFlowSessions } from "../persistence/reader.js";

/** 单条 flow 摘要 */
interface FlowSummaryEntry {
  taskId: string;
  timestamp: number;
  summary: string;
}

/**
 * 加载最近 N 个 flow 的摘要
 *
 * @param flowsDir - 顶层 flows/ 目录（如 flows/）
 * @param stoneName - 对象名称（筛选该对象参与的 flow）
 * @param currentTaskId - 当前 flow 的 taskId（排除自身）
 * @param maxFlows - 最多加载多少个有摘要的 flow
 * @param maxChars - 摘要总长度上限
 * @returns 格式化的摘要文本，无摘要则返回 null
 */
export function loadFlowSummaries(
  flowsDir: string,
  stoneName: string,
  currentTaskId: string,
  maxFlows: number = 5,
  maxChars: number = 2000,
): string | null {
  const sessionIds = listFlowSessions(flowsDir);
  if (sessionIds.length === 0) return null;

  /* 收集有摘要的 flow，按时间倒序 */
  const entries: FlowSummaryEntry[] = [];

  for (const sessionId of sessionIds) {
    if (sessionId === currentTaskId) continue;

    /* 尝试读取 session 根目录的 data.json（main flow） */
    const dataPath = join(flowsDir, sessionId, "data.json");
    if (!existsSync(dataPath)) continue;

    try {
      const raw = JSON.parse(readFileSync(dataPath, "utf-8"));
      if (typeof raw.summary === "string" && raw.summary.trim()) {
        entries.push({
          taskId: sessionId,
          timestamp: raw.updatedAt ?? raw.createdAt ?? 0,
          summary: raw.summary.trim(),
        });
      }
    } catch {
      /* 解析失败，跳过 */
    }
  }

  if (entries.length === 0) return null;

  /* 按时间倒序排列 */
  entries.sort((a, b) => b.timestamp - a.timestamp);

  /* 拼接，控制总长度 */
  const lines: string[] = [];
  let totalChars = 0;

  for (const entry of entries.slice(0, maxFlows)) {
    const time = new Date(entry.timestamp).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    const line = `- [${entry.taskId} ${time}] ${entry.summary}`;
    if (totalChars + line.length > maxChars) break;
    lines.push(line);
    totalChars += line.length;
  }

  return lines.length > 0 ? lines.join("\n") : null;
}
