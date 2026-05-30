// src/executable/prototype/self-meta.ts
import yaml from "js-yaml";
import { builtinProtoId } from "./constants";

/** self.md 解析结果。 */
export interface SelfMeta {
  /** 规范化后的父节点 canonical id；null = 链终点；缺省 = root。 */
  extends: string | null;
  /** frontmatter 之后的正文（无 frontmatter 时即整篇）。 */
  body: string;
}

/**
 * 把 extends frontmatter 原始值规范化为 canonical id（D2）：
 * - 含 "://" → 视为已规范化的完整 URI，原样返回
 * - 裸 token → builtin 原型简写：ooc://stones/_builtin/objects/<token>
 *
 * 不处理 null/缺省——那由 parseSelfMeta 决定（缺省→root、显式 null→终点）。
 */
export function normalizeExtends(raw: string): string {
  return raw.includes("://") ? raw : builtinProtoId(raw);
}

/**
 * 解析 self.md：拆 frontmatter / body，导出规范化 extends。
 *
 * 边界（对齐 knowledge parser）：
 * - 不以 `---\n` 开头 → 整篇作 body，extends 默认 root。
 * - frontmatter 无 extends key → 默认 root。
 * - extends: null（YAML null）→ 链终点 null。
 * - extends: <string> → normalizeExtends。
 * - yaml 损坏 → 退化为"无 frontmatter"（整篇作 body，默认 root；不静默吞掉非 extends 字段语义）。
 */
export function parseSelfMeta(text: string): SelfMeta {
  const DEFAULT_PARENT = builtinProtoId("root"); // ooc://stones/_builtin/objects/root
  const { frontmatter, body } = splitFrontmatter(text);
  if (frontmatter === undefined) return { extends: DEFAULT_PARENT, body };

  if (!("extends" in frontmatter)) return { extends: DEFAULT_PARENT, body };
  const raw = frontmatter.extends;
  if (raw === null) return { extends: null, body };
  if (typeof raw !== "string") {
    throw new Error(`self.md frontmatter extends 必须是 string 或 null，得到: ${typeof raw}`);
  }
  return { extends: normalizeExtends(raw), body };
}

function splitFrontmatter(text: string): { frontmatter: Record<string, unknown> | undefined; body: string } {
  if (!text.startsWith("---\n")) return { frontmatter: undefined, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: undefined, body: text };
  const fmText = text.slice(4, end);
  const body = text.slice(end + 5);
  let parsed: unknown;
  try {
    parsed = yaml.load(fmText);
  } catch {
    return { frontmatter: undefined, body: text };
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return { frontmatter: parsed as Record<string, unknown>, body };
  }
  return { frontmatter: undefined, body: text };
}
