/**
 * 把用户 ts/js 代码包成一个 ES module 文本。
 *
 * 约定：
 * - import 必须在模块顶层 → 提取出来放最前
 * - 其它代码塞进 default async 函数体
 * - `_result_` 由 wrapper 预先 `let` 声明，用户直接赋值即可
 */
export function wrapUserCode(code: string): string {
  const lines = code.split("\n");
  const importLines: string[] = [];
  const bodyLines: string[] = [];
  for (const line of lines) {
    if (/^\s*import\s/.test(line)) {
      importLines.push(line);
    } else {
      bodyLines.push(line);
    }
  }

  return [
    ...importLines,
    "export default async function(console, self) {",
    "  let _result_;",
    bodyLines.join("\n"),
    "  return _result_;",
    "}"
  ].join("\n");
}
