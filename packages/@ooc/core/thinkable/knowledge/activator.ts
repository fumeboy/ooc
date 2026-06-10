import type { ThreadContext } from "../context";
import {
  evaluateTrigger,
  maxLevel,
  parseTrigger,
  type Trigger,
} from "./activator.expr";
import type { ActivationLevel, ActivationResult, KnowledgeIndex } from "@ooc/core/_shared/types/knowledge.js";
import type { KnowledgeWindow } from "@ooc/core/executable/windows/_shared/types.js";

/** 激活集合上限，避免 context 爆炸。 */
const MAX_RESULTS = 20;

/**
 * 给定线程上下文与 knowledge 索引，计算本轮应渲染的激活集合。
 *
 * trigger map 协议：每篇 knowledge 的 frontmatter.activates_on 是
 * `Record<triggerExpr, "show_description" | "show_content">`。本函数对每篇
 * knowledge 逐条 evaluate 其 triggers，把命中级别取 max 作为该篇最终级别。
 *
 * 显式 knowledge_window（用户 open_knowledge）：仍然走 force-full 路径，
 * 不论 activates_on 是否命中。
 *
 * 输出顺序：force-full → activator-full → activator-summary；上限 MAX_RESULTS。
 */
export function computeActivations(
  thread: ThreadContext,
  index: KnowledgeIndex,
): ActivationResult[] {
  // 收集显式打开的 knowledge_window 的 path（force-full）
  const forced = new Set<string>();
  for (const window of thread.contextWindows ?? []) {
    if (window.type === "knowledge") {
      forced.add((window as KnowledgeWindow).path);
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
    if (!on || typeof on !== "object" || Array.isArray(on)) continue;

    const level = evaluateActivatesOn(on, thread, doc.file);
    if (level === undefined) continue;

    if (level === "show_content") {
      fullCandidates.push({
        path: doc.path,
        presentation: "full",
        doc,
        reason: "trigger_full",
      });
    } else {
      summaryCandidates.push({
        path: doc.path,
        presentation: "summary",
        doc,
        reason: "trigger_summary",
      });
    }
  }

  out.push(...fullCandidates, ...summaryCandidates);
  return out.slice(0, MAX_RESULTS);
}

/**
 * 对一篇 knowledge 的 activates_on map 求值。
 *
 * - 逐条解析 + evaluate trigger
 * - 任一 trigger parse 失败（写错语法）→ console.warn 并跳过该条（不让整篇失效）
 * - 多 trigger 命中取 max（show_content > show_description）
 *
 * parse 错应该在 loader 阶段已被 fail-loud；本函数的容错是双保险（loader 改后
 * 也可能在缓存里残留旧解析；这里不让错误篇拖垮整次 activator）。
 */
function evaluateActivatesOn(
  activates_on: Record<string, unknown>,
  thread: ThreadContext,
  filePath: string,
): ActivationLevel | undefined {
  const hits: ActivationLevel[] = [];
  for (const [expr, levelRaw] of Object.entries(activates_on)) {
    if (levelRaw !== "show_description" && levelRaw !== "show_content") {
      console.warn(
        `[knowledge-activator] ${filePath} activates_on["${expr}"] invalid level=${JSON.stringify(levelRaw)}; skipped`,
      );
      continue;
    }
    let trigger: Trigger;
    try {
      trigger = parseTrigger(expr);
    } catch (err) {
      console.warn(
        `[knowledge-activator] ${filePath} activates_on key "${expr}" parse failed: ${(err as Error).message}; skipped`,
      );
      continue;
    }
    if (evaluateTrigger(trigger, thread)) {
      hits.push(levelRaw);
    }
  }
  return maxLevel(hits);
}
