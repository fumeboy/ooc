export type {
  ActivatesOn,
  ActivationLevel,
  ActivationResult,
  KnowledgeDoc,
  KnowledgeFrontmatter,
  KnowledgeIndex
} from "@ooc/core/_shared/types/knowledge.js";
export { parseKnowledgeFile } from "./parser";
// loader（双源磁盘加载 + 继承链）已搬入 knowledge_base builtin（@ooc/builtins/knowledge_base/loader）；
// core/thinkable/knowledge 只留 parser / activator（激活求值）/ 类型。
export { computeActivations } from "./activator";
export {
  evaluateTrigger,
  maxLevel,
  parseActivatesOn,
  parseTrigger,
  type Trigger,
} from "./activator.expr";
