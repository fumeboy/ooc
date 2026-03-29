/**
 * 工具 Trait 方法的统一返回类型
 * - ok: true 时包含 data
 * - ok: false 时包含 error 和可选的 context（帮助 LLM 修正）
 */
export type ToolResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; context?: string };

/** 创建成功结果的辅助函数 */
export function toolOk<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}

/** 创建失败结果的辅助函数 */
export function toolErr<T = never>(
  error: string,
  context?: string,
): ToolResult<T> {
  return { ok: false, error, context };
}
