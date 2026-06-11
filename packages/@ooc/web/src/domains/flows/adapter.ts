import type { FlowSession } from "./model";

/**
 * sidebar / list 显示用的 session 标题。
 *
 * 当 title === sessionId（旧 session 或前端未派生 title 时的退化态）, 这种字面
 * 值（如 `web-1779214834923`）对用户毫无信息量。本函数在 UI 边界做表层 humanize:
 *   - title 不存在 / 等于 sessionId / 为空 → 退回 `Session · <创建时间相对>`
 *   - 否则原样返回 title
 *
 * Supervisor 哲学层约束: 这一轮**不**引入 displayName 模型字段（task #19 未决）, 也不动 backend。
 */
export function flowTitle(flow: FlowSession) {
  const raw = (flow.title ?? "").trim();
  if (raw && raw !== flow.sessionId) return raw;
  return `Session · ${formatRelativeTime(flow.createdAt)}`;
}

function formatRelativeTime(ts: number): string {
  if (!Number.isFinite(ts)) return "刚刚";
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return "刚刚";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  const date = new Date(ts);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

