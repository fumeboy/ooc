/**
 * thinkable/knowledge —— knowledge 文件类型 + parser。
 *
 * 双源 loader / activator 已退役（搬入 builtins/knowledge_base 后再重写一次）。
 */
export type {
  ActivatesOn,
  ActivationLevel,
  ActivationResult,
  KnowledgeDoc,
  KnowledgeFrontmatter,
  KnowledgeIndex,
} from "@ooc/core/types/knowledge.js";
export { parseKnowledgeFile } from "./parser.js";
