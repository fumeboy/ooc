export type {
  ActivatesOn,
  ActivationLevel,
  ActivationResult,
  KnowledgeDoc,
  KnowledgeFrontmatter,
  KnowledgeIndex
} from "@ooc/core/_shared/types/knowledge.js";
export { parseKnowledgeFile } from "./parser";
export { clearKnowledgeLoaderCache, loadKnowledgeIndex, loadKnowledgeIndexFromDir, type KnowledgeLoadRefs } from "./loader";
export { computeActivations } from "./activator";
export {
  evaluateTrigger,
  maxLevel,
  parseActivatesOn,
  parseTrigger,
  type Trigger,
} from "./activator.expr";
