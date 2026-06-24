export interface StoneBranch {
  worldDir: string;
  branch?: string;
}

/**
 * stone / flow 目录用来分隔嵌套子 Agent 的 marker 子目录名。
 *
 * 物理布局示例（stone 与 flow 形态对齐）：
 *   objectId = "parent/child" → stones/parent/children/child
 */
export const CHILDREN_SUBDIR = "children";

/**
 * 把 "/" 分隔的 objectId 翻译成 children/ 嵌套的物理 path segments。
 *
 * 例：
 *   "a"       → ["a"]
 *   "a/b"     → ["a", "children", "b"]
 *   "a/b/c"   → ["a", "children", "b", "children", "c"]
 *
 * 与 stoneDir / objectDir 共用，避免双份逻辑。
 */
export function nestedObjectPath(
  objectId: string
): string[] {
  const segments = objectId.split("/").filter(Boolean);
  return segments.flatMap((seg, i) => (i === 0 ? [seg] : [CHILDREN_SUBDIR, seg]));
}

/** 判断一个 objectId 是否指向 Builtin Object（运行时自带、Agent 不可改写）。 */
export function isBuiltinObjectId(objectId: string): boolean {
  if (objectId.startsWith("_builtin/")) return true;
  return false
}

/** 序列化 JSON 的统一格式：两空格缩进 + 末尾换行。 */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
