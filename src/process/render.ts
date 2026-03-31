/**
 * 行为树文本渲染 (G5/G9)
 *
 * 将行为树渲染为 LLM 可读的文本表示。
 * Focus 路径上的节点显示详细信息，其余只显示摘要。
 *
 * @ref docs/哲学文档/gene.md#G5 — implements — Context 中的 process 字段（focus 路径详细、其余摘要）
 * @ref docs/哲学文档/gene.md#G9 — implements — 行为树可视化渲染
 * @ref src/process/tree.ts — references — getPathToNode, findNode
 * @ref src/process/focus.ts — references — isProcessComplete
 * @ref src/types/process.ts — references — Process, ProcessNode 类型
 */

import type { Process, ProcessNode } from "../types/index.js";
import { getPathToNode, findNode } from "./tree.js";
import { isProcessComplete } from "./focus.js";

/** 状态标记 */
const STATUS_ICON: Record<string, string> = {
  todo: "[ ]",
  doing: "[*]",
  done: "[✓]",
};

/**
 * 将行为树渲染为文本
 *
 * 规则（G5 结构化遗忘）：
 * - Focus 路径上的节点：显示标题 + 状态 + actions 摘要
 * - 其他节点：只显示标题 + 状态（+ 摘要）
 * - 折叠已完成子树
 * - 末尾显示当前 focus 目标提示
 *
 * @param process - 行为树
 * @returns 文本表示
 */
export function renderProcess(process: Process): string {
  if (!process.root) return "(无行为树)";

  const focusPath = new Set(
    getPathToNode(process.root, process.focusId).map((n) => n.id),
  );

  const tree = renderNode(process.root, focusPath, process.focusId, 0);
  const todoText = renderTodo(process);

  /* 行为树全部完成时，提示对象可以结束任务 */
  if (isProcessComplete(process)) {
    return `${tree}${todoText}\n\n所有步骤已完成。如果任务目标已达成，请输出 [finish]。`;
  }

  /* 添加 focus 目标提示 */
  const focusNode = findNode(process.root, process.focusId);
  if (focusNode) {
    const desc = focusNode.description ? `\n说明: ${focusNode.description}` : "";
    const outputDesc = focusNode.outputDescription ? `\n预期输出: ${focusNode.outputDescription}` : "";
    const outputs = focusNode.outputs && focusNode.outputs.length > 0
      ? `\n输出契约: ${focusNode.outputs.join(", ")}`
      : "";
    return `${tree}${todoText}\n\n当前目标: ${focusNode.title}${desc}${outputDesc}${outputs}`;
  }

  return `${tree}${todoText}`;
}

function renderNode(
  node: ProcessNode,
  focusPath: Set<string>,
  focusId: string,
  indent: number,
): string {
  const prefix = "  ".repeat(indent);
  const icon = STATUS_ICON[node.status] ?? "[ ]";
  const isFocus = node.id === focusId;
  const isOnPath = focusPath.has(node.id);

  let line = `${prefix}${icon} ${node.title}`;

  /* 显示栈帧携带的 traits */
  const allTraits = [
    ...(node.traits ?? []),
    ...(node.activatedTraits ?? []),
  ];
  if (allTraits.length > 0) {
    line += ` [traits: ${allTraits.join(", ")}]`;
  }

  if (isFocus) line += " ← focus";
  if (node.summary) {
    line += ` (${node.summary})`;
  }

  /* 【契约式编程】显示 outputs 约定（任何状态都显示） */
  if (node.outputs && node.outputs.length > 0) {
    line += ` [outputs: ${node.outputs.join(", ")}]`;
  }

  /* 已完成节点如果有 locals（artifacts），显示 key 列表 */
  if (node.status === "done" && node.locals && Object.keys(node.locals).length > 0) {
    line += ` [artifacts: ${Object.keys(node.locals).join(", ")}]`;
  }

  const lines: string[] = [line];

  /* 在 focus 节点或路径上的节点显示 description */
  if ((isFocus || isOnPath) && node.description) {
    lines.push(`${prefix}  说明: ${node.description}`);
  }

  /* Focus 路径上或当前 focus 节点：展开子节点 */
  if (isOnPath || isFocus) {
    /* 展示最近的 actions 摘要（只在 focus 节点） */
    if (isFocus && node.actions.length > 0) {
      const recent = node.actions.slice(-3);
      for (const action of recent) {
        const brief = action.content.slice(0, 80).replace(/\n/g, " ");
        lines.push(`${prefix}  | ${action.type}: ${brief}...`);
      }
    }

    for (const child of node.children) {
      lines.push(renderNode(child, focusPath, focusId, indent + 1));
    }
  } else if (node.children.length > 0) {
    /* 不在路径上：折叠显示子节点数量 */
    const done = node.children.filter((c) => c.status === "done").length;
    const total = node.children.length;
    lines.push(`${prefix}  (${done}/${total} 子节点完成)`);
  }

  return lines.join("\n");
}

/**
 * 渲染 TodoList
 */
function renderTodo(process: Process): string {
  const todo = process.todo;
  if (!todo || todo.length === 0) return "";

  const lines: string[] = ["\n\n待办队列:"];
  for (let i = 0; i < todo.length; i++) {
    const item = todo[i]!;
    const marker = i === 0 ? "[当前]" : `${i + 1}.`;
    const tag = item.source === "interrupt" ? " (中断)" : "";
    lines.push(`  ${marker} ${item.title}${tag}`);
  }
  return lines.join("\n");
}
