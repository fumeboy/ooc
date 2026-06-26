/**
 * activator —— 在求值环境下从 KnowledgeIndex 计算激活集。
 *
 * 算法：
 *   1. 遍历 index.byPath 每篇 doc
 *   2. 解析其 frontmatter.activates_on 成 trigger map
 *   3. 对每条 trigger 求值；命中的取 max 级别
 *   4. 输出 ActivationResult[]（按 path 字典序，便于稳定渲染）
 */
import type {
  ActivationLevel,
  ActivationResult,
  KnowledgeDoc,
  KnowledgeIndex,
} from "./types.js";
import {
  type ActivationContext,
  evaluateTrigger,
  maxLevel,
  parseActivatesOn,
} from "./expr.js";

function resultFor(doc: KnowledgeDoc, level: ActivationLevel): ActivationResult {
  return {
    path: doc.path,
    presentation: level === "show_content" ? "full" : "summary",
    doc,
    reason: level === "show_content" ? "trigger_full" : "trigger_summary",
  };
}

/** 计算给定环境下的激活集。 */
export function computeActivations(
  index: KnowledgeIndex,
  env: ActivationContext,
): ActivationResult[] {
  const out: ActivationResult[] = [];
  for (const doc of index.byPath.values()) {
    const triggers = parseActivatesOn(doc.frontmatter.activates_on, doc.file);
    let best: ActivationLevel | undefined;
    for (const [trigger, lvl] of triggers) {
      if (evaluateTrigger(trigger, env)) best = maxLevel(best, lvl);
    }
    if (best) out.push(resultFor(doc, best));
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}
