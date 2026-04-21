/**
 * 线程 Context 可见性分类器
 *
 * 给定一棵线程树和 focus 节点 ID，计算每个节点在 focus 线程 Context 中的呈现形态。
 *
 * 分类规则（与 `context-builder.ts` 严格一致）：
 * - **detailed**：focus 自身。process 区段渲染了完整 actions。
 * - **summary**：祖先链 + 直接子 + 同级兄弟中，拥有 `summary` 字段的节点。
 * - **title_only**：祖先链 + 直接子 + 同级兄弟中，**没有** `summary` 字段的节点
 *   （renderAncestor/Children/SiblingSummary 会降级为"只有 title + status"输出）。
 * - **hidden**：其他所有节点（uncle/aunt 的子树、堂兄弟的子树、子节点的子节点、孤立节点 …）。
 *
 * 为什么规则是这样：
 * - 祖先由 `renderAncestorSummary` 收集（`getAncestorPath(...).slice(0, -1)`）
 * - 子由 `renderChildrenSummary` 收集（只看 `node.childrenIds`）
 * - 兄弟由 `renderSiblingSummary` 收集（只看 `parent.childrenIds.filter(id ≠ self)`）
 * - 这三个函数都只深入一层或只走祖先链，所以 uncle / cousin / 孙 等都被排除。
 *
 * @ref docs/超工程管理/迭代/all/20260421_feature_thread上下文可视化.md
 * @ref kernel/src/thread/context-builder.ts
 */

import type { ThreadsTreeFile } from "./types.js";
import { getAncestorPath } from "./persistence.js";

/** 上下文可见性分类 */
export type ContextVisibility =
  | "detailed"    /* focus 自身：完整 actions 可见 */
  | "summary"     /* title + summary 出现在 Context */
  | "title_only"  /* 只有 title 出现（summary 为空） */
  | "hidden";     /* 不在 Context 里 */

/**
 * 判定单个节点是否拥有有效 summary（非空字符串）。
 * 与 context-builder 的 `if (node.summary) { line += " — " + summary }` 行为一致。
 */
function hasSummary(summary?: string): boolean {
  return typeof summary === "string" && summary.length > 0;
}

/**
 * 给定线程树 + focus 节点 ID，返回每个节点相对于 focus 的 Context 可见性分类。
 *
 * 返回 map 覆盖 `tree.nodes` 中全部节点；focus 不存在时返回空 map。
 *
 * @param tree - 线程树
 * @param focusId - 观察主体线程 ID
 * @returns `{ [threadId]: ContextVisibility }` —— 每个节点的分类
 */
export function classifyContextVisibility(
  tree: ThreadsTreeFile,
  focusId: string,
): Record<string, ContextVisibility> {
  const focusNode = tree.nodes[focusId];
  if (!focusNode) return {};

  const result: Record<string, ContextVisibility> = {};

  /* 1. 默认所有节点 = hidden */
  for (const id of Object.keys(tree.nodes)) {
    result[id] = "hidden";
  }

  /* 2. focus 自身 = detailed */
  result[focusId] = "detailed";

  /* 3. 祖先链（Root → focus 的父，不含 focus 自身）
   *    与 context-builder.renderAncestorSummary 一致：path.slice(0, -1)
   */
  const ancestorPath = getAncestorPath(tree, focusId).slice(0, -1);
  for (const ancestorId of ancestorPath) {
    const node = tree.nodes[ancestorId];
    if (!node) continue;
    result[ancestorId] = hasSummary(node.summary) ? "summary" : "title_only";
  }

  /* 4. 直接子节点
   *    与 context-builder.renderChildrenSummary 一致：遍历 focusNode.childrenIds
   */
  for (const childId of focusNode.childrenIds) {
    const child = tree.nodes[childId];
    if (!child) continue;
    result[childId] = hasSummary(child.summary) ? "summary" : "title_only";
  }

  /* 5. 同级兄弟（同一父节点下的其他子节点）
   *    与 context-builder.renderSiblingSummary 一致：parent.childrenIds 去掉 self
   */
  if (focusNode.parentId) {
    const parent = tree.nodes[focusNode.parentId];
    if (parent) {
      for (const sibId of parent.childrenIds) {
        if (sibId === focusId) continue;
        const sib = tree.nodes[sibId];
        if (!sib) continue;
        result[sibId] = hasSummary(sib.summary) ? "summary" : "title_only";
      }
    }
  }

  return result;
}
