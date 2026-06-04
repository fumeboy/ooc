/**
 * executable 子系统 — 公开门面（barrel）。
 *
 * 2026-06-04 Phase F: collectExecutableKnowledgeEntries has been decomposed into the
 * ContextPipeline processor chain. What remains here are standalone utilities.
 */

export {
  computeFormKnowledgeEntries,
  enrichFormMethodKnowledge,
  BASIC_KNOWLEDGE_PATH,
  KNOWLEDGE,
  // @deprecated Phase F: use ContextPipeline instead
  collectExecutableKnowledgeEntries,
} from "../thinkable/knowledge/index.js";
