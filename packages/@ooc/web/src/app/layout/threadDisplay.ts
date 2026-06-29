/**
 * thread id 表层 humanize。
 *
 * 设计原则（Supervisor 哲学层约束）:
 *   - 这一轮不引入跨模块的 displayName 字段（task #19 未决）。
 *   - 只在 UI 边界做表层折叠 —— 原始 thread id 永远保留, 通过 title attr / hover 仍可见。
 *
 * 规则:
 *   - `root` → `root`（最常见，原样）
 *   - `t_user_*`（user 通过 talk 派生的 callee thread）→ `user-talk`
 *   - 其它 → 后 6 字符前加 `…`，例如 `t_a8b2c3d4e5f6` → `…d4e5f6`
 */
export function humanizeThreadId(threadId: string): string {
  if (!threadId) return threadId;
  if (threadId === "root") return "root";
  if (threadId.startsWith("t_user_")) return "user-talk";
  if (threadId.length <= 6) return threadId;
  return "…" + threadId.slice(-6);
}
