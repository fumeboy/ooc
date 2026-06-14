/**
 * 进程执行记录 —— terminal_process / interpreter_process 共用的 history 条目与格式化。
 *
 * terminal_process（bash）与 interpreter_process（ts/js）都把每次 exec 包成一条 ProcessExecRecord
 * 追加进自己的 history。两者结构一致（语言不同、运行时不同），故记录类型与输出格式化收在 _shared。
 */

/** 单条进程执行记录。 */
export interface ProcessExecRecord {
  execId: string;
  language: "shell" | "ts" | "js";
  code?: string;
  output: string;
  ok: boolean;
  startedAt: number;
}

/** ts/js 用户代码的执行结果。 */
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

/** 把 bash 进程的 stdout/stderr/exitCode 格式化为单一字符串。 */
export function formatShellResult(code: string, stdout: string, stderr: string, exitCode: number): string {
  const firstLine = code.split("\n")[0]?.trim() ?? "";
  const lines = [`$ ${firstLine}`];
  if (stdout) lines.push("[stdout]", truncateOutput(stdout));
  if (stderr) lines.push("[stderr]", truncateOutput(stderr));
  lines.push(exitCode === 124 ? "[timeout 30s]" : `[exit ${exitCode}]`);
  return lines.join("\n");
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
    head.startsWith("[terminal_process") ||
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
