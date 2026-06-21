/**
 * interpreter_process 的 ts/js 执行结果与格式化 —— 把 sandbox executor 的产物包成单一输出串。
 */

/** ts/js 用户代码的执行结果（sandbox executor 的返回形态）。 */
export interface InterpreterExecutionResult {
  /** 是否成功完成（无异常）。 */
  success: boolean;
  /** 用户代码 _result_ 的值；undefined 时表示用户没显式赋值。 */
  returnValue: unknown;
  /** 累积的 console 输出。 */
  stdout: string;
  /** 失败时的错误描述（含粗略行号定位）。 */
  error?: string;
}

const MAX_OUTPUT_BYTES = 4096;

export function truncateOutput(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= MAX_OUTPUT_BYTES) return text;
  const head = new TextDecoder().decode(bytes.slice(0, MAX_OUTPUT_BYTES));
  return `${head}...[truncated, original ${bytes.length} bytes]`;
}

/** 把 ts/js executor 的结果统一格式化为单一字符串。 */
export function formatInterpreterResult(
  header: string,
  stdout: string,
  returnValue: unknown,
  error?: string,
): string {
  const lines = [header];
  if (stdout) lines.push("[stdout]", truncateOutput(stdout));
  if (returnValue !== undefined) {
    const text = typeof returnValue === "string" ? returnValue : JSON.stringify(returnValue, null, 2);
    lines.push("[returnValue]", truncateOutput(text));
  }
  if (error) {
    lines.push("[error]", truncateOutput(error), "[exit 1]");
  } else {
    lines.push("[exit 0]");
  }
  return lines.join("\n");
}

/** result 字符串里包含失败标记时视为 ok=false。 */
export function isOkResult(result: string): boolean {
  const head = result.slice(0, 256);
  return !(
    head.startsWith("[process-error]") ||
    head.startsWith("[interpreter_process") ||
    head.includes("缺少") ||
    head.includes("失败") ||
    head.includes("不存在") ||
    head.includes("不在") ||
    head.includes("[error]")
  );
}

export function generateExecId(): string {
  return `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
