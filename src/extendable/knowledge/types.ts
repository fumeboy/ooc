/**
 * Knowledge 引用（trait / view / relation 三类知识统一表示）
 *
 * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
 */

export type KnowledgeType = "trait" | "view" | "relation";

export type KnowledgeSource =
  | { kind: "origin" }
  | { kind: "form_match"; path: string }
  | { kind: "relation"; path: string }
  | { kind: "open_action" };

export type KnowledgePresentation = "summary" | "full";

export interface KnowledgeRef {
  /** 知识类型 */
  type: KnowledgeType;
  /** 引用，如 "@trait:talkable" / "@view:foo" / "@relation:user" */
  ref: string;
  /** 这条 ref 为何被激活 */
  source: KnowledgeSource;
  /** summary = 索引行；full = 进 open-files 全文 */
  presentation: KnowledgePresentation;
  /** 打开 file 时的可选参数（如 lines=200）。presentation=full 时生效 */
  openFileArgs?: Record<string, string | number>;
  /** 必带的解释字段 */
  reason: string;
}
