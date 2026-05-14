import type { ThreadContext } from "../context";
import type { ActivationResult, KnowledgeIndex } from "./types";

/** 激活集合上限，避免 context 爆炸。 */
const MAX_RESULTS = 20;

/**
 * 给定线程上下文与 knowledge 索引，计算本轮应渲染的激活集合。
 *
 * Step 2 重构（spec 2026-05-14）：
 * - 显式打开的 knowledge_window.path 视为 force-full（取代旧 pinnedKnowledge）
 * - command_exec window 的 commandPaths union 仍是自动激活的来源
 * - 同一篇 knowledge 同时被 force-full 与命中 show_description_when 时，full 优先
 *
 * 输出顺序：force-full（knowledge_window 显式打开）→ command-path full → command-path summary。
 * 超过 MAX_RESULTS 时截尾。
 */
export function computeActivations(
  thread: ThreadContext,
  index: KnowledgeIndex
): ActivationResult[] {
  // 收集 command_exec window 的 commandPaths union
  const union = new Set<string>();
  // 收集显式打开的 knowledge_window 的 path（force-full）
  const forced = new Set<string>();
  for (const window of thread.contextWindows ?? []) {
    if (window.type === "command_exec") {
      for (const p of window.commandPaths) union.add(p);
    } else if (window.type === "knowledge") {
      forced.add(window.path);
    }
  }

  const seen = new Set<string>();
  const out: ActivationResult[] = [];

  // 1) 显式打开的 knowledge_window：强制 full
  for (const path of forced) {
    const doc = index.byPath.get(path);
    if (!doc) continue;
    seen.add(path);
    out.push({ path, presentation: "full", doc, reason: "pinned" });
  }

  // 2) 自动激活：先 full，再 summary
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
