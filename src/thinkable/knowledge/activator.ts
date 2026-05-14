import type { ThreadContext } from "../context";
import type { ActivationResult, KnowledgeIndex } from "./types";

/** 激活集合上限，避免 context 爆炸。 */
const MAX_RESULTS = 20;

/**
 * 给定线程上下文与 knowledge 索引，计算本轮应渲染的激活集合。
 *
 * Step 1 重构（spec 2026-05-14）：
 * - 旧 thread.activeForms 改为 thread.contextWindows 中的 command_exec 子集
 * - 旧 thread.pinnedKnowledge 字段已删；显式固定 knowledge 由 Step 2 的
 *   knowledge_window 承担。本 step 暂时仅按 command_exec 的 commandPaths union 激活
 *
 * 输出顺序：command-path full → command-path summary。超过 MAX_RESULTS 时截尾。
 */
export function computeActivations(
  thread: ThreadContext,
  index: KnowledgeIndex
): ActivationResult[] {
  // 收集所有 command_exec window 的 commandPaths union
  const union = new Set<string>();
  for (const window of thread.contextWindows ?? []) {
    if (window.type !== "command_exec") continue;
    for (const p of window.commandPaths) union.add(p);
  }

  const fullCandidates: ActivationResult[] = [];
  const summaryCandidates: ActivationResult[] = [];
  for (const doc of index.byPath.values()) {
    const on = doc.frontmatter.activates_on;
    if (!on) continue;
    const fullHit = (on.show_content_when ?? []).some((p) => union.has(p));
    if (fullHit) {
      fullCandidates.push({
        path: doc.path,
        presentation: "full",
        doc,
        reason: "command_path_full"
      });
      continue;
    }
    const summaryHit = (on.show_description_when ?? []).some((p) => union.has(p));
    if (summaryHit) {
      summaryCandidates.push({
        path: doc.path,
        presentation: "summary",
        doc,
        reason: "command_path_summary"
      });
    }
  }

  return [...fullCandidates, ...summaryCandidates].slice(0, MAX_RESULTS);
}
