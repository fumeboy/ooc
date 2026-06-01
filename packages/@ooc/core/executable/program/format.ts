const MAX_OUTPUT_BYTES = 4096;

function truncate(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= MAX_OUTPUT_BYTES) return text;
  const head = new TextDecoder().decode(bytes.slice(0, MAX_OUTPUT_BYTES));
  return `${head}...[truncated, original ${bytes.length} bytes]`;
}

export function formatShellResult(code: string, stdout: string, stderr: string, exitCode: number): string {
  const firstLine = code.split("\n")[0]?.trim() ?? "";
  const lines = [`$ ${firstLine}`];
  if (stdout) lines.push("[stdout]", truncate(stdout));
  if (stderr) lines.push("[stderr]", truncate(stderr));
  lines.push(exitCode === 124 ? "[timeout 30s]" : `[exit ${exitCode}]`);
  return lines.join("\n");
}

/** 把 ts/js executor 的结果与 function path 的返回值统一格式化为单一字符串。 */
export function formatProgramResult(
  header: string,
  stdout: string,
  returnValue: unknown,
  error?: string,
): string {
  const lines = [header];
  if (stdout) lines.push("[stdout]", truncate(stdout));
  if (returnValue !== undefined) {
    const text = typeof returnValue === "string" ? returnValue : JSON.stringify(returnValue, null, 2);
    lines.push("[returnValue]", truncate(text));
  }
  if (error) {
    lines.push("[error]", truncate(error), "[exit 1]");
  } else {
    lines.push("[exit 0]");
  }
  return lines.join("\n");
}
