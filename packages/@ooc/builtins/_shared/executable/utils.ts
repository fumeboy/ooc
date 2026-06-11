/**
 * Shared low-level helpers for builtin object methods.
 *
 * Extracted the byte-identical micro-helpers that were
 * copy-pasted across builtins/{root,plan,file,knowledge,...}/executable/.
 *
 * Removed `emptyIntent` (the intent(args) method was deleted from ObjectMethod;
 * intents now come from onFormChange's returned MethodExecuteForm).
 */

/** typeof 字符串守卫——窄化 `unknown` 到 `string`。 */
export function isString(v: unknown): v is string {
  return typeof v === "string";
}

/** 取路径最后一段（按 "/" 或 "\\" 分隔）；无分隔符则原样返回。 */
export function basenameOfPath(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/**
 * 解析 `[number, number]` 元组；非法返回 undefined。
 * 同时被 readable 维度（file set_range window method）与 executable 维度
 * （open_file constructor 的 lines/columns）使用，故放共享层避免两维度互相 import。
 */
export function asTuple(value: unknown): [number, number] | undefined {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    return [value[0], value[1]];
  }
  return undefined;
}
