/**
 * terminal_process 的 bash 执行记录格式化 —— 把子进程 stdout/stderr/exitCode 包成单一输出串。
 */

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

/** result 字符串里包含失败标记时视为 ok=false。 */
export function isOkResult(result: string): boolean {
  const head = result.slice(0, 256);
  return !(
    head.startsWith("[process-error]") ||
    head.startsWith("[terminal_process") ||
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
