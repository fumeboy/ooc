/**
 * 行为树文本渲染 (G5/G9)
 *
 * 将行为树渲染为 LLM 可读的文本表示。
 * 新设计：一维时间线展示，聚焦路径上的 actions 按时间顺序排列。
 *
 * @ref docs/哲学文档/gene.md#G5 — implements — Context 中的 process 字段（focus 路径详细、其余摘要）
 * @ref docs/哲学文档/gene.md#G9 — implements — 行为树可视化渲染
 * @ref src/process/tree.ts — references — getPathToNode, findNode
 * @ref src/process/focus.ts — references — isProcessComplete
 * @ref src/types/process.ts — references — Process, ProcessNode 类型
 */

import type { Process, ProcessNode, NodeType } from "../types/index.js";
import type { Action } from "../types/flow.js";
import { getPathToNode, findNode } from "./tree.js";
import { isProcessComplete } from "./focus.js";

/** 段落分隔符常量 */
const SECTION_SEPARATOR =
  "══════════════════════════════════════════════════════════";

/**
 * 时间线事件类型（用于构建一维时间线）
 */
type TimelineEvent =
  | { type: "action"; action: Action; nodeId: string; nodeTitle: string }
  | { type: "push"; nodeId: string; nodeTitle: string; timestamp: number; nodeType?: NodeType }
  | {
      type: "pop";
      nodeId: string;
      nodeTitle: string;
      timestamp: number;
      nodeType?: NodeType;
      summary?: string;
      description?: string;
      artifacts?: Record<string, unknown>;
    };

/**
 * 格式化时间戳为 HH:MM:SS 格式
 *
 * @param timestamp - 毫秒级时间戳
 * @returns 格式化后的时间字符串
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * 获取节点的第一个 action 时间戳
 */
function getNodeFirstTimestamp(node: ProcessNode, defaultTs: number): number {
  if (node.actions.length > 0) {
    return node.actions[0]!.timestamp;
  }
  return defaultTs;
}

/**
 * 获取节点的最后一个 action 时间戳
 */
function getNodeLastTimestamp(node: ProcessNode, defaultTs: number): number {
  if (node.actions.length > 0) {
    return node.actions[node.actions.length - 1]!.timestamp;
  }
  return defaultTs;
}

/**
 * 为单个节点生成事件
 *
 * @param node - 节点
 * @param isRoot - 是否为根节点
 * @param isFocus - 是否为当前 focus 节点
 * @param isOnPath - 是否在当前聚焦路径上
 * @returns 该节点的事件列表
 */
function generateEventsForNode(
  node: ProcessNode,
  isRoot: boolean,
  isFocus: boolean,
  isOnPath: boolean,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const baseTs = getNodeFirstTimestamp(node, 0);

  // 非根节点添加 push 事件
  if (!isRoot) {
    const pushTs =
      node.actions.length > 0
        ? node.actions[0]!.timestamp - 1
        : baseTs;
    events.push({
      type: "push",
      nodeId: node.id,
      nodeTitle: node.title,
      timestamp: pushTs,
      nodeType: node.type,
    });
  }

  // 添加该节点的所有 action 事件
  for (const action of node.actions) {
    events.push({
      type: "action",
      action,
      nodeId: node.id,
      nodeTitle: node.title,
    });
  }

  // 对于不在路径上且已完成且不是当前 focus 的节点，添加 pop 事件
  // 路径上的已完成节点（ancestors）是聚焦路径的一部分，不应该被渲染为 [sub_stack_frame]
  if (node.status === "done" && !isFocus && !isOnPath) {
    const popTs =
      node.actions.length > 0
        ? node.actions[node.actions.length - 1]!.timestamp + 1
        : getNodeLastTimestamp(node, baseTs) + 1;

    events.push({
      type: "pop",
      nodeId: node.id,
      nodeTitle: node.title,
      timestamp: popTs,
      nodeType: node.type,
      summary: node.summary,
      description: node.description,
      artifacts: node.locals,
    });
  }

  return events;
}

/**
 * 收集聚焦路径上的所有事件，按时间戳排序
 *
 * 扩展规则（支持已完成子栈帧展示）：
 * - 遍历路径上的每个节点
 * - 对于路径上的每个节点，还需要收集它的已完成直接子节点
 * - 对于非根节点，在开始处添加 push 事件
 * - 添加该节点的所有 action 事件
 * - 对于已完成且不是当前 focus 的节点，在末尾添加 pop 事件
 *
 * 注意：已完成子节点的子节点会被折叠（结构化遗忘），不递归收集
 *
 * @param path - 从根到 focus 节点的路径
 * @param focusId - 当前 focus 节点 ID
 * @returns 按时间戳排序的事件列表
 */
export function collectTimelineEvents(
  path: ProcessNode[],
  focusId: string,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const pathIds = new Set(path.map((n) => n.id));

  // 收集需要处理的节点：
  // 1. 路径上的所有节点 (isOnPath = true)
  // 2. 路径上节点的已完成直接子节点（不在路径上的，isOnPath = false）
  const nodesToProcess: {
    node: ProcessNode;
    isRoot: boolean;
    isFocus: boolean;
    isOnPath: boolean;
  }[] = [];

  for (let i = 0; i < path.length; i++) {
    const node = path[i]!;
    const isRoot = i === 0;
    const isFocus = node.id === focusId;

    // 添加路径上的节点 (isOnPath = true)
    nodesToProcess.push({ node, isRoot, isFocus, isOnPath: true });

    // 添加该节点的已完成直接子节点（不在路径上的）
    // 这些是曾经被 focus 过、现在已完成的子栈帧 (isOnPath = false)
    for (const child of node.children) {
      if (child.status === "done" && !pathIds.has(child.id)) {
        // 已完成的子节点：不是根，不是 focus，不在路径上
        nodesToProcess.push({
          node: child,
          isRoot: false,
          isFocus: false,
          isOnPath: false,
        });
      }
    }
  }

  // 为每个节点生成事件
  for (const { node, isRoot, isFocus, isOnPath } of nodesToProcess) {
    events.push(...generateEventsForNode(node, isRoot, isFocus, isOnPath));
  }

  // 按时间戳排序，时间戳相同时按事件类型优先级排序
  // 优先级: push (0) -> action (1) -> pop (2)
  events.sort((a, b) => {
    const getTs = (e: TimelineEvent): number => {
      if (e.type === "push") return e.timestamp;
      if (e.type === "pop") return e.timestamp;
      if (e.type === "action") return e.action.timestamp;
      return 0;
    };

    const getTypePriority = (e: TimelineEvent): number => {
      if (e.type === "push") return 0;
      if (e.type === "action") return 1;
      if (e.type === "pop") return 2;
      return 3;
    };

    const tsDiff = getTs(a) - getTs(b);
    if (tsDiff !== 0) return tsDiff;

    // 时间戳相同时，按类型优先级排序
    return getTypePriority(a) - getTypePriority(b);
  });

  return events;
}

/**
 * 格式化单个事件为字符串数组
 *
 * @param event - 时间线事件
 * @returns 格式化后的字符串行
 */
export function formatEvent(event: TimelineEvent): string[] {
  const lines: string[] = [];

  if (event.type === "push") {
    // 检查是否是内联节点
    if (event.nodeType === "inline_before") {
      lines.push(`[inline/before_start]`);
      lines.push("");
    } else if (event.nodeType === "inline_after") {
      lines.push(`[inline/after_start]`);
      lines.push("");
    } else if (event.nodeType === "inline_reflect") {
      lines.push(`[inline/reflect_start]`);
      lines.push("");
    } else {
      // 普通子栈帧
      lines.push(`[push] ${event.nodeTitle}`);
      lines.push(`进入子栈帧: ${event.nodeTitle}`);
      lines.push("");
    }
  } else if (event.type === "pop") {
    // 检查是否是内联节点
    if (event.nodeType === "inline_before") {
      lines.push(`[inline/before_end]`);
      if (event.summary) {
        lines.push(`  summary: ${event.summary}`);
      }
      lines.push("");
    } else if (event.nodeType === "inline_after") {
      lines.push(`[inline/after_end]`);
      if (event.summary) {
        lines.push(`  summary: ${event.summary}`);
      }
      lines.push("");
    } else if (event.nodeType === "inline_reflect") {
      lines.push(`[inline/reflect_end]`);
      if (event.summary) {
        lines.push(`  summary: ${event.summary}`);
      }
      lines.push("");
    } else {
      // 普通子栈帧 - 已完成
      lines.push(`[sub_stack_frame] ${event.nodeTitle} [✓ done]`);
      const input = event.description || "(无)";
      lines.push(`输入: ${input}`);
      lines.push(`输出 summary: ${event.summary || "(无)"}`);
      const artifactKeys = event.artifacts
        ? Object.keys(event.artifacts).join(", ")
        : "";
      if (artifactKeys) {
        lines.push(`输出 artifacts: ${artifactKeys} (已合并到父帧)`);
      } else {
        lines.push("输出 artifacts: (无)");
      }
      lines.push("");
    }
  } else if (event.type === "action") {
    const { action } = event;
    const ts = formatTimestamp(action.timestamp);

    if (action.type === "thought") {
      lines.push(`[${ts}] [thought]`);
      lines.push(action.content);
      lines.push("");
    } else if (action.type === "program") {
      lines.push(`[${ts}] [program]`);
      lines.push(action.content);
      lines.push("");
      if (action.success !== undefined) {
        const status = action.success ? "✓ 成功" : "❌ 失败";
        lines.push(`>>> 执行结果: ${status}`);
      }
      if (action.result !== undefined && action.result !== "") {
        lines.push(`>>> 输出: ${action.result}`);
      }
      if (action.success !== undefined || (action.result !== undefined && action.result !== "")) {
        lines.push("");
      }
    } else if (action.type === "inject") {
      lines.push(`[${ts}] [inject]`);
      lines.push(action.content);
      lines.push("");
    } else {
      // 其他类型 (action, message_in, message_out, pause)
      lines.push(`[${ts}] [${action.type}]`);
      lines.push(action.content);
      lines.push("");
    }
  }

  return lines;
}

/**
 * 获取节点的状态显示文本
 */
function getNodeStatusText(node: ProcessNode): string {
  if (node.status === "doing") return "* doing";
  if (node.status === "done") return "✓ done";
  return "todo";
}

/**
 * 格式化【当前状态】区域
 *
 * @param focusNode - 当前 focus 节点
 * @param path - 从根到 focus 节点的路径
 * @returns 格式化后的字符串行
 */
export function formatCurrentStatus(
  focusNode: ProcessNode,
  path: ProcessNode[],
): string[] {
  const lines: string[] = [];

  lines.push(SECTION_SEPARATOR);
  lines.push("【当前状态】");
  lines.push(SECTION_SEPARATOR);
  lines.push("");

  lines.push(`当前帧: ${focusNode.title} [${getNodeStatusText(focusNode)}]`);
  lines.push("");

  // 收集所有激活的 traits
  const allTraits: string[] = [];
  for (const node of path) {
    if (node.traits) allTraits.push(...node.traits);
    if (node.activatedTraits) allTraits.push(...node.activatedTraits);
  }
  // 去重
  const uniqueTraits = [...new Set(allTraits)];
  if (uniqueTraits.length > 0) {
    lines.push(`激活 traits: ${uniqueTraits.join(", ")}`);
  } else {
    lines.push("激活 traits: (无)");
  }
  lines.push("");

  // 收集路径上所有 locals 的 key
  const allVarKeys: string[] = [];
  for (const node of path) {
    if (node.locals) {
      allVarKeys.push(...Object.keys(node.locals));
    }
  }
  const uniqueVarKeys = [...new Set(allVarKeys)];
  if (uniqueVarKeys.length > 0) {
    lines.push(`可访问变量名: ${uniqueVarKeys.join(", ")}`);
  } else {
    lines.push("可访问变量名: (无)");
  }
  lines.push("");

  // 输出契约
  lines.push("输出契约:");
  const outputs = focusNode.outputs || [];
  if (outputs.length > 0) {
    lines.push(`  outputs: ${outputs.join(", ")}`);
  } else {
    lines.push("  outputs: (无)");
  }
  if (focusNode.outputDescription) {
    lines.push(`  输出描述: ${focusNode.outputDescription}`);
  } else {
    lines.push("  输出描述: (无)");
  }

  return lines;
}

/**
 * 渲染 TodoList
 */
function formatTodo(process: Process): string[] {
  const todo = process.todo;
  if (!todo || todo.length === 0) return [];

  const lines: string[] = ["", "【待办队列】"];
  for (let i = 0; i < todo.length; i++) {
    const item = todo[i]!;
    const marker = i === 0 ? "[当前]" : `${i + 1}.`;
    const tag = item.source === "interrupt" ? " (中断)" : "";
    lines.push(`  ${marker} ${item.title}${tag}`);
  }
  return lines;
}

/**
 * 将行为树渲染为文本
 *
 * 新设计规则（简化认知栈）：
 * - 一维列表展示：不需要缩进，聚焦路径上的 actions 按时间顺序排列
 * - 段落格式一致：保持和 LLM Output 相同的段落格式
 * - 增加信息：时间戳、[program] 的结果展示
 * - [push] 段落：展示子栈帧的开始
 * - [pop] 不展示：pop 后节点被 summary 并折叠
 * - [sub_stack_frame] 段落：完成 pop 的节点以此格式展示
 * - 【当前状态】区域：只展示变量名，不展示值
 * - 结构化遗忘：不在聚焦路径上的节点完全不展示
 *
 * @param process - 行为树
 * @returns 文本表示
 */
export function renderProcess(process: Process): string {
  if (!process.root) return "(无行为树)";

  // 获取 focus 节点和路径
  const focusNode = findNode(process.root, process.focusId);
  if (!focusNode) {
    return "(无行为树)";
  }
  const path = getPathToNode(process.root, process.focusId);

  // 构建头部区域
  const output: string[] = [];
  output.push(SECTION_SEPARATOR);
  output.push(
    `【认知栈】当前帧: ${focusNode.title} [${getNodeStatusText(focusNode)}]`,
  );
  output.push(SECTION_SEPARATOR);
  output.push("");

  // 新增：plan 字段展示
  if (focusNode.plan) {
    output.push("【当前计划】");
    output.push(focusNode.plan);
    output.push("");
  }

  // 构建聚焦路径区域
  output.push("【聚焦路径】（按时间顺序排列）");
  output.push("");

  const events = collectTimelineEvents(path, process.focusId);
  for (const event of events) {
    output.push(...formatEvent(event));
  }

  // 构建当前状态区域
  output.push(...formatCurrentStatus(focusNode, path));

  // 添加待办队列
  output.push(...formatTodo(process));

  let result = output.join("\n");

  // 行为树全部完成时，提示对象可以结束任务
  if (isProcessComplete(process)) {
    result += `\n\n所有步骤已完成。如果任务目标已达成，请输出 [finish]。`;
  }

  return result;
}
