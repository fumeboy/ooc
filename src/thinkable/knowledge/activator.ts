import type { ThreadContext } from "../context";
import type { ActivationResult, KnowledgeIndex } from "./types";

/** 激活集合上限，避免 context 爆炸。 */
const MAX_RESULTS = 20;

/**
 * 给定线程上下文与 knowledge 索引，计算本轮应渲染的激活集合。
 *
 * 输出顺序：pinned（强制 full）→ command-path full → command-path summary。
 * pinned 与自动激活同一篇时，去重，pinned 优先。
 * 超过 MAX_RESULTS 时截尾。
 */
export function computeActivations(
  thread: ThreadContext,
  index: KnowledgeIndex
): ActivationResult[] {
  // 1) 收集 commandPaths union（所有 activeForms 的 commandPaths 去重）
  const union = new Set<string>();
  for (const f of thread.activeForms ?? []) {
    for (const p of f.commandPaths) union.add(p);
  }
  const pinned = new Set(thread.pinnedKnowledge ?? []);

  const seen = new Set<string>();
  const out: ActivationResult[] = [];

  // 2) pinned 优先输出，强制 full
  for (const path of pinned) {
    const doc = index.byPath.get(path);
    if (!doc) continue;
    seen.add(path);
    out.push({ path, presentation: "full", doc, reason: "pinned" });
  }

  // 3) 自动激活：先 full，再 summary
  const fullCandidates: ActivationResult[] = [];
  const summaryCandidates: ActivationResult[] = [];
  for (const doc of index.byPath.values()) {
    if (seen.has(doc.path)) continue;
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
  out.push(...fullCandidates, ...summaryCandidates);

  return out.slice(0, MAX_RESULTS);
}
