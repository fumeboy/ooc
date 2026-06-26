/**
 * thinkable/knowledge —— knowledge 文件类型 + parser + activator。
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
export {
  parseTrigger,
  parseActivatesOn,
  evaluateTrigger,
  maxLevel,
  type Trigger,
  type ActivationContext,
} from "./activator.expr.js";
export { computeActivations } from "./activator.js";
export {
  setSourceIntents,
  clearSourceIntents,
  getAllActiveIntents,
  getSourceIntents,
  resetSourceIntentsStore,
} from "./source-intents.js";
