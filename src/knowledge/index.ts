export { traitId, resolveTraitRef, getActiveTraits, getChildTraits, computeKnowledgeRefs, type ComputeRefsInput } from "./activator.js";
export type {
  KnowledgeType,
  KnowledgeSource,
  KnowledgePresentation,
  KnowledgeRef,
} from "./types.js";
export { buildPathReverseIndex, lookupTraitsByPaths, type PathReverseIndex } from "./reverse-index.js";
