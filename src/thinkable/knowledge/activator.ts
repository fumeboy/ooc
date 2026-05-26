import type { ThreadContext } from "../context";
import type { ActivationResult, KnowledgeIndex } from "./types";

/** 激活集合上限，避免 context 爆炸。 */
const MAX_RESULTS = 20;

/**
 * 给定线程上下文与 knowledge 索引，计算本轮应渲染的激活集合。
 *
 * 命令路径来源（union 收集，根因 #9 扩充）：
 * - `root`：永远在 union 中——base path，允许 `activates_on:[root]` 这类
 *   "无论何时都该露面"的 seed knowledge 激活（R4 #24 修）
 * - 任何 thread.contextWindows 中 status="open" 的 window 类型贡献 path：
 *   talk / do / file / search / relation / knowledge / ... 持续 open 时
 *   每轮都贡献其 type 作为 path——让 `activates_on:[talk]` 这种"我在跟人 talk
 *   就该看到 talk 知识"的直觉成立（R6 #42 修）
 * - command_exec window 的 commandPaths（form 进行中）
 * - program_window 最近一次 exec 推断的路径（program / program.<language>）
 *
 * 显式 knowledge_window：path 视为 force-full（取代旧 pinnedKnowledge）。
 * 同一篇 knowledge 同时被 force-full 与命中 show_description_when 时，full 优先。
 *
 * 输出顺序：force-full → command-path full → command-path summary。
 * 超过 MAX_RESULTS 时截尾。
 */
export function computeActivations(
  thread: ThreadContext,
  index: KnowledgeIndex
): ActivationResult[] {
  // 收集命令路径 union（含 root、open windows、command_exec、program 推断）
  const union = new Set<string>();
  // root 永远在 union 中：允许 activates_on:[root] 类 seed knowledge 在任意轮激活
  union.add("root");
  // 收集显式打开的 knowledge_window 的 path（force-full）
  const forced = new Set<string>();
  for (const window of thread.contextWindows ?? []) {
    // 任何 status="open" 的 window，type 都贡献 implicit path
    // (R6 #42: window-type-as-state)。command_exec/program 仍保留下面更细致的路径
    if (window.status === "open" || window.status === undefined) {
      union.add(window.type);
    }
    if (window.type === "command_exec") {
      for (const p of window.commandPaths) union.add(p);
    } else if (window.type === "knowledge") {
      forced.add(window.path);
    } else if (window.type === "program" && window.status === "open") {
      const recent = window.history[window.history.length - 1];
      if (recent) {
        union.add("program");
        if (recent.language === "shell") union.add("program.shell");
        else if (recent.language === "ts") union.add("program.ts");
        else if (recent.language === "js") union.add("program.js");
      }
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
