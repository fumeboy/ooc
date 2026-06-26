/**
 * builtins/knowledge_base/activator —— knowledge 激活机制（issue N: 从 core/thinkable/knowledge 迁入）。
 *
 * 哲学（用户原话）：「core 负责产出意图,ooc class 可以基于这个约定来实现基于意图的知识、记忆
 * 激活匹配,builtin class knowledge_base 就是实现之一」。本目录是 knowledge_base 的实现细节：
 *
 *   - types.ts        —— frontmatter / doc / index 纯类型
 *   - parser.ts       —— .md → frontmatter + body
 *   - expr.ts         —— activates_on trigger 解析 + 求值（单一 intent 维度）
 *   - activator.ts    —— computeActivations 算法
 *
 * 激活时被 `../readable/index.ts` 调用,渲为 `<knowledge>` XML 节点。
 */
export type {
  ActivatesOn,
  ActivationLevel,
  ActivationResult,
  KnowledgeDoc,
  KnowledgeFrontmatter,
  KnowledgeIndex,
} from "./types.js";
export { parseKnowledgeFile } from "./parser.js";
export {
  parseTrigger,
  parseActivatesOn,
  evaluateTrigger,
  maxLevel,
  type Trigger,
  type ActivationContext,
} from "./expr.js";
export { computeActivations } from "./activator.js";
