/**
 * Focus 光标管理 (G9)
 *
 * Focus 光标指向当前正在处理的节点。
 * 栈进（进入子节点）：加载子节点详细 context，折叠兄弟。
 * 栈出（完成子节点，回到父节点）：回收子节点 context，替换为摘要。
 *
 * 关键规则：focus 离开一个 doing 节点时，自动为该节点生成摘要。
 * 这是「结构化遗忘」的核心——离开即遗忘细节，只保留摘要。
 *
 * @ref .ooc/docs/哲学文档/gene.md#G9 — implements — focus 光标移动规则（深度优先、依赖感知、完成回退）
 * @ref .ooc/docs/哲学文档/gene.md#G5 — implements — 结构化遗忘（栈进加载/栈出回收）
 * @ref src/process/tree.ts — references — findNode, getParentNode 节点查找
 * @ref src/types/process.ts — references — Process, ProcessNode 类型
 */

import type { Process, ProcessNode } from "../types/index.js";
import { findNode, getParentNode } from "./tree.js";

/**
 * 从节点的 actions 中生成摘要
 *
 * 规则：取最后 3 个 action 的关键信息拼接。
 * 如果节点已有 summary（手动设置的），保留不覆盖。
 */
function autoSummarize(node: ProcessNode): string {
  if (node.summary) return node.summary;
  if (node.actions.length === 0) return `${node.title}（进行中）`;

  const recent = node.actions.slice(-3);
  const parts: string[] = [];
  for (const a of recent) {
    if (a.type === "thought") {
      /* 取思考的前 60 字符 */
      const text = a.content.replace(/```[\s\S]*?```/g, "").trim();
      if (text) parts.push(text.slice(0, 60));
    } else if (a.type === "program") {
      parts.push(a.success ? "程序执行成功" : "程序执行失败");
    }
  }
  return parts.join("; ").slice(0, 120) || `${node.title}（进行中）`;
}

/**
 * moveFocus 返回结果
 */
export interface MoveFocusResult {
  success: boolean;
  yieldedNodeId?: string;
}

/**
 * advanceFocus 返回结果
 */
export interface AdvanceFocusResult {
  focusId: string | null;
  yieldedNodeId?: string;
}

/**
 * 移动 focus 到指定节点
 *
 * 关键行为：离开旧节点时自动生成摘要（结构化遗忘）。
 *
 * @returns 移动结果，包含是否成功和被 yield 的节点 ID
 */
export function moveFocus(process: Process, targetId: string): MoveFocusResult {
  const node = findNode(process.root, targetId);
  if (!node) return { success: false };

  let yieldedNodeId: string | undefined;
  /* 离开旧节点时自动总结 */
  const oldNode = findNode(process.root, process.focusId);
  if (oldNode && oldNode.id !== targetId && oldNode.status === "doing") {
    if (!oldNode.summary) {
      oldNode.summary = autoSummarize(oldNode);
    }
    yieldedNodeId = oldNode.id;
  }

  process.focusId = targetId;
  if (node.status === "todo") {
    node.status = "doing";
  }
  return { success: true, yieldedNodeId };
}

/**
 * 自动推进 focus（深度优先）
 *
 * 规则：
 * 1. 当前节点有未完成的子节点 → focus 进入第一个可执行的子节点
 * 2. 当前节点所有子节点完成 → 当前节点可以完成
 * 3. 依赖检查：如果节点有 deps 且依赖未完成，跳过
 *
 * 离开旧节点时自动生成摘要。
 *
 * @returns 推进结果，包含新的 focusId 和被 yield 的节点 ID
 */
export function advanceFocus(process: Process): AdvanceFocusResult {
  const current = findNode(process.root, process.focusId);
  if (!current) return { focusId: null };

  let yieldedNodeId: string | undefined;

  /* 尝试进入子节点（栈进） */
  const nextChild = findNextChild(process, current);
  if (nextChild) {
    /* 离开当前节点前自动总结 */
    if (current.status === "doing" && !current.summary) {
      current.summary = autoSummarize(current);
    }
    yieldedNodeId = current.id;
    process.focusId = nextChild.id;
    nextChild.status = "doing";
    return { focusId: nextChild.id, yieldedNodeId };
  }

  /* 当前节点无可执行子节点，向上回退（栈出） */
  let backtrackNode = current;
  while (true) {
    const parent = getParentNode(process.root, backtrackNode.id);
    if (!parent) return { focusId: null };

    /* 离开当前节点前自动总结 */
    if (backtrackNode.status === "doing" && !backtrackNode.summary) {
      backtrackNode.summary = autoSummarize(backtrackNode);
    }
    /* 只在第一次回退时记录 yield */
    if (!yieldedNodeId && backtrackNode.id === current.id) {
      yieldedNodeId = backtrackNode.id;
    }

    /* 检查父节点是否有下一个可执行的兄弟 */
    const nextSibling = findNextChild(process, parent);
    if (nextSibling) {
      process.focusId = nextSibling.id;
      nextSibling.status = "doing";
      return { focusId: nextSibling.id, yieldedNodeId };
    }

    /* 无兄弟可执行 → 检查父节点是否应自动完成 */
    if (parent.children.every((c) => c.status === "done")) {
      parent.status = "done";
      if (!parent.summary) {
        parent.summary = autoSummarize(parent);
      }
      /* 继续向上回退 */
      backtrackNode = parent;
      continue;
    }

    /* 父节点仍有未完成工作，focus 回到父节点 */
    process.focusId = parent.id;
    return { focusId: parent.id, yieldedNodeId };
  }
}

/**
 * 在父节点的子节点中找到下一个可执行的节点
 *
 * 规则：
 * - 跳过 done 节点
 * - 跳过依赖未满足的节点
 * - 优先 doing 节点，然后 todo 节点
 */
function findNextChild(process: Process, parent: ProcessNode): ProcessNode | null {
  /* 先找 doing 的 */
  for (const child of parent.children) {
    if (child.status === "doing") return child;
  }

  /* 再找 todo 且依赖满足的 */
  for (const child of parent.children) {
    if (child.status === "todo" && isDepsResolved(process, child)) {
      return child;
    }
  }

  return null;
}

/**
 * 检查节点的依赖是否已完成
 */
function isDepsResolved(process: Process, node: ProcessNode): boolean {
  if (!node.deps || node.deps.length === 0) return true;

  for (const depId of node.deps) {
    const depNode = findNode(process.root, depId);
    if (!depNode || depNode.status !== "done") return false;
  }

  return true;
}

/**
 * 获取当前 focus 节点
 */
export function getFocusNode(process: Process): ProcessNode | null {
  return findNode(process.root, process.focusId);
}

/**
 * 检查行为树是否全部完成
 */
export function isProcessComplete(process: Process): boolean {
  return isSubtreeComplete(process.root);
}

function isSubtreeComplete(node: ProcessNode): boolean {
  if (node.children.length === 0) return node.status === "done";
  return node.children.every(isSubtreeComplete);
}
