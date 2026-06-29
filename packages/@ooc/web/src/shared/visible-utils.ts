/**
 * visible-utils — 共享 visible 工具函数 (2026-06-29 inline 到 web/)。
 *
 * 来源: ooc-6 时代 `@ooc/builtins/_shared/visible/utils.ts`,该包已不存在 (issue O
 * builtin 命名空间重整后);此处 inline 一份纯 helper 函数,供 web 各 visible 组件用。
 *
 * 函数:
 * - formatJson: 安全 JSON.stringify 含 try/catch
 * - previewText: 文本截短预览 (含 ... 省略号)
 * - statusToTone: 状态字符串 → UI tone (info/warn/error/success)
 */

export type Tone = "info" | "warn" | "error" | "success" | "muted" | "neutral";

export function formatJson(value: unknown, maxLen = 4000): string {
  try {
    const str = JSON.stringify(value, null, 2);
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + "\n... (truncated)";
  } catch (err) {
    return `[unserializable: ${(err as Error).message}]`;
  }
}

export function previewText(value: unknown, maxLen = 200): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

export function statusToTone(status: string | undefined): Tone {
  if (!status) return "muted";
  const lower = status.toLowerCase();
  if (lower.includes("error") || lower.includes("fail") || lower === "rejected") return "error";
  if (lower.includes("warn") || lower === "pending") return "warn";
  if (lower === "done" || lower === "success" || lower === "approved") return "success";
  if (lower === "running" || lower === "active") return "info";
  return "muted";
}
