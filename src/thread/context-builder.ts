/**
 * 线程 Context 构建器
 *
 * 为每个线程构建独立的 Context，包含执行视角和规划视角。
 * 与旧 builder（kernel/src/context/builder.ts）完全独立。
 *
 * 执行视角：whoAmI + parentExpectation + plan + process + locals + windows
 * 规划视角：children 摘要 + inbox + todos + directory
 *
 * 三种创建方式的 Context 差异：
 * - create_sub_thread：初始 process = 父线程渲染快照（inject action）
 * - create_sub_thread_on_node：初始 process = 空白 + 目标节点完整历史
 * - talk：初始 process = 空白
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#5
 */

import type { StoneData, DirectoryEntry, ContextWindow, TraitDefinition } from "../types/index.js";
import type {
  ThreadsTreeFile,
  ThreadsTreeNodeMeta,
  ThreadDataFile,
  ThreadAction,
  ThreadInboxMessage,
  ThreadTodoItem,
  ThreadStatus,
} from "./types.js";
import { getAncestorPath } from "./persistence.js";
import { getActiveTraits, traitId as activatorTraitId } from "../trait/activator.js";

/**
 * 获取 trait 的完整标识（本地版本，避免循环依赖）
 */
function localTraitId(trait: TraitDefinition): string {
  if (trait.namespace && !trait.name.startsWith(trait.namespace + "/")) {
    return `${trait.namespace}/${trait.name}`;
  }
  return trait.name;
}

/** 线程 Context（双视角） */
export interface ThreadContext {
  /* === 执行视角 === */
  /** Object 名称 */
  name: string;
  /** 身份描述 */
  whoAmI: string;
  /** 父线程的期望（title + description） */
  parentExpectation: string;
  /** 当前计划 */
  plan: string;
  /** actions 时间线（渲染后的文本） */
  process: string;
  /** 局部变量 */
  locals: Record<string, unknown>;
  /** 系统指令窗口（kernel trait readme） */
  instructions: ContextWindow[];
  /** 知识窗口（user trait readme + 动态 windows） */
  knowledge: ContextWindow[];

  /* === 规划视角 === */
  /** 子节点摘要 */
  childrenSummary: string;
  /** 祖先节点摘要（Root → 父节点，不含自身） */
  ancestorSummary: string;
  /** 兄弟节点摘要（同一父节点下的其他子节点） */
  siblingSummary: string;
  /** unread inbox 消息 */
  inbox: ThreadInboxMessage[];
  /** pending 待办 */
  todos: ThreadTodoItem[];
  /** 通讯录 */
  directory: DirectoryEntry[];

  /* === 元信息 === */
  /** 激活的 traits（scope chain） */
  scopeChain: string[];
  /** 沙箱路径 */
  paths?: Record<string, string>;
  /** 线程状态 */
  status: ThreadStatus;
}

/** buildThreadContext 的输入参数 */
export interface ThreadContextInput {
  /** 线程树 */
  tree: ThreadsTreeFile;
  /** 当前线程 ID */
  threadId: string;
  /** 当前线程数据 */
  threadData: ThreadDataFile;
  /** Stone 数据 */
  stone: StoneData;
  /** 通讯录 */
  directory: DirectoryEntry[];
  /** 所有已加载的 traits */
  traits: TraitDefinition[];
  /** 额外知识窗口 */
  extraWindows?: ContextWindow[];
  /** 沙箱路径 */
  paths?: Record<string, string>;
  /**
   * 目标节点数据（仅 create_sub_thread_on_node 场景使用）
   *
   * 当通过 create_sub_thread_on_node 创建子线程时，需要将目标节点的
   * 完整 actions 历史展示在 Context 中。Phase 5 完善具体渲染逻辑。
   */
  targetNodeData?: ThreadDataFile;
}

/**
 * 判断是否为 kernel trait（前缀匹配）
 *
 * kernel trait 的 readme 注入到 instructions 区域（系统指令），
 * 非 kernel trait 注入到 knowledge 区域（知识窗口）。
 */
function isKernelTrait(id: string): boolean {
  return id.startsWith("kernel/");
}

/**
 * 构建线程 Context
 *
 * @param input - 构建参数
 * @returns 完整的线程 Context
 */
export function buildThreadContext(input: ThreadContextInput): ThreadContext {
  const { tree, threadId, threadData, stone, directory, traits, extraWindows, paths } = input;
  const nodeMeta = tree.nodes[threadId];
  if (!nodeMeta) {
    throw new Error(`[buildThreadContext] 节点不存在: ${threadId}`);
  }

  /* 1. scope chain：沿祖先链合并 traits */
  const scopeChain = computeThreadScopeChain(tree, threadId);

  /* 2. 激活 traits（使用完整版 activator，支持 deps 递归激活） */
  const activeTraits = getActiveTraits(traits, scopeChain);

  const instructions: ContextWindow[] = activeTraits
    .filter(t => t.readme && isKernelTrait(localTraitId(t)))
    /* 排除旧 output_format trait，线程树引擎会注入新版输出格式 */
    .filter(t => localTraitId(t) !== "kernel/computable/output_format")
    .map(t => ({ name: localTraitId(t), content: t.readme }));

  const knowledge: ContextWindow[] = activeTraits
    .filter(t => t.readme && !isKernelTrait(localTraitId(t)))
    .map(t => ({ name: localTraitId(t), content: t.readme }));

  if (extraWindows) knowledge.push(...extraWindows);

  /* 3. parentExpectation
   *
   * 语义：用当前节点的 title + description 构成"父线程对我的期望"。
   * 为什么用当前节点的 description 而不是父节点的？
   * 因为 description 是父线程在 create_sub_thread 时指定的，
   * 描述的是"你被要求做什么"，属于当前节点的元数据，
   * 而父节点的 title/description 描述的是父线程自身的任务。
   * parentExpectation = 父节点的 title（提供上级任务名称）
   *                   + 当前节点的 description（提供具体要求）
   */
  let parentExpectation = "";
  if (nodeMeta.parentId) {
    const parent = tree.nodes[nodeMeta.parentId];
    if (parent) {
      parentExpectation = parent.title;
      if (nodeMeta.description) {
        parentExpectation += `\n${nodeMeta.description}`;
      }
    }
  }

  /* 4. process：渲染 actions 时间线 */
  const process = renderThreadProcess(threadData.actions);

  /* 5. 规划视角 */
  const childrenSummary = renderChildrenSummary(tree, threadId);
  const ancestorSummary = renderAncestorSummary(tree, threadId);
  const siblingSummary = renderSiblingSummary(tree, threadId);
  const inbox = (threadData.inbox ?? []).filter(m => m.status === "unread");
  const todos = (threadData.todos ?? []).filter(t => t.status === "pending");

  /* 6. locals：从 threadData 读取 */
  const locals: Record<string, unknown> = {};
  if (threadData.locals) Object.assign(locals, threadData.locals);

  return {
    name: stone.name,
    whoAmI: stone.thinkable.whoAmI,
    parentExpectation,
    plan: threadData.plan ?? "",
    process,
    locals,
    instructions,
    knowledge,
    childrenSummary,
    ancestorSummary,
    siblingSummary,
    inbox,
    todos,
    directory: directory.filter(d => d.name !== stone.name),
    scopeChain,
    paths,
    status: nodeMeta.status,
  };
}

/**
 * 沿祖先链计算 scope chain（合并所有 traits + activatedTraits）
 *
 * 复用阶段 1 的 getAncestorPath（返回 Root → leaf 顺序），
 * 保证 scope chain 的遍历顺序与 spec Section 5.3 一致：
 * Root 的 traits 在前，leaf 的 traits 在后。
 *
 * @param tree - 线程树
 * @param nodeId - 目标节点 ID
 * @returns 去重后的 trait 名称列表（Root → leaf 顺序）
 */
export function computeThreadScopeChain(tree: ThreadsTreeFile, nodeId: string): string[] {
  const path = getAncestorPath(tree, nodeId); /* Root → leaf 顺序 */
  const seen = new Set<string>();
  const result: string[] = [];

  for (const id of path) {
    const node = tree.nodes[id];
    if (!node) continue;

    if (node.traits) {
      for (const t of node.traits) {
        if (!seen.has(t)) { seen.add(t); result.push(t); }
      }
    }
    if (node.activatedTraits) {
      for (const t of node.activatedTraits) {
        if (!seen.has(t)) { seen.add(t); result.push(t); }
      }
    }
  }

  return result;
}

/**
 * 渲染子节点摘要（规划视角）
 *
 * 格式：每个子节点一行，包含 title + status + summary（如有）
 *
 * @param tree - 线程树
 * @param nodeId - 父节点 ID
 * @returns 渲染后的摘要文本，无子节点时返回空字符串
 */
export function renderChildrenSummary(tree: ThreadsTreeFile, nodeId: string): string {
  const node = tree.nodes[nodeId];
  if (!node || node.childrenIds.length === 0) return "";

  const lines: string[] = [];
  for (const childId of node.childrenIds) {
    const child = tree.nodes[childId];
    if (!child) continue;

    let line = `- [${child.status}] ${child.title}`;
    if (child.summary) {
      line += ` — ${child.summary}`;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * 渲染祖先节点摘要（从 Root 到父节点，不含自身）
 *
 * 格式：每个祖先节点一行，包含 title + status + summary（如有），
 * 用缩进表示层级关系。
 *
 * @param tree - 线程树
 * @param nodeId - 当前节点 ID
 * @returns 渲染后的摘要文本，Root 节点返回空字符串
 */
export function renderAncestorSummary(tree: ThreadsTreeFile, nodeId: string): string {
  const path = getAncestorPath(tree, nodeId); /* Root → ... → nodeId */
  /* 去掉自身，只保留祖先 */
  const ancestors = path.slice(0, -1);
  if (ancestors.length === 0) return "";

  const lines: string[] = [];
  for (let i = 0; i < ancestors.length; i++) {
    const node = tree.nodes[ancestors[i]!];
    if (!node) continue;

    const indent = "  ".repeat(i);
    let line = `${indent}- [${node.status}] ${node.title}`;
    if (node.summary) {
      line += ` — ${node.summary}`;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * 渲染兄弟节点摘要（同一父节点下的其他子节点）
 *
 * @param tree - 线程树
 * @param nodeId - 当前节点 ID
 * @returns 渲染后的摘要文本，无兄弟时返回空字符串
 */
export function renderSiblingSummary(tree: ThreadsTreeFile, nodeId: string): string {
  const node = tree.nodes[nodeId];
  if (!node || !node.parentId) return "";

  const parent = tree.nodes[node.parentId];
  if (!parent) return "";

  const siblings = parent.childrenIds.filter(id => id !== nodeId);
  if (siblings.length === 0) return "";

  const lines: string[] = [];
  for (const sibId of siblings) {
    const sib = tree.nodes[sibId];
    if (!sib) continue;

    let line = `- [${sib.status}] ${sib.title}`;
    if (sib.summary) {
      line += ` — ${sib.summary}`;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * 渲染线程 actions 时间线（执行视角的 process）
 *
 * 按时间戳排序，格式化为 LLM 可读的文本。
 * 与旧 renderProcess 的区别：不需要行为树结构，直接渲染 actions 列表。
 *
 * @param actions - 线程的 actions 列表
 * @returns 渲染后的文本
 */
export function renderThreadProcess(actions: ThreadAction[]): string {
  if (actions.length === 0) return "(无历史)";

  /* 按时间戳排序 */
  const sorted = [...actions].sort((a, b) => a.timestamp - b.timestamp);

  const lines: string[] = [];
  for (const action of sorted) {
    const ts = formatTimestamp(action.timestamp);

    switch (action.type) {
      case "thought":
        lines.push(`[${ts}] [thought]`);
        lines.push(action.content);
        lines.push("");
        break;

      case "program":
        lines.push(`[${ts}] [program]`);
        lines.push(action.content);
        if (action.success !== undefined) {
          lines.push(`>>> ${action.success ? "成功" : "失败"}: ${action.result ?? "(无输出)"}`);
        }
        lines.push("");
        break;

      case "inject":
        lines.push(`[${ts}] [inject]`);
        lines.push(action.content);
        lines.push("");
        break;

      case "message_in":
        lines.push(`[${ts}] [message_in]`);
        lines.push(action.content);
        lines.push("");
        break;

      case "message_out":
        lines.push(`[${ts}] [message_out]`);
        lines.push(action.content);
        lines.push("");
        break;

      case "create_thread":
        lines.push(`[${ts}] [create_thread] ${action.content}`);
        lines.push("");
        break;

      case "thread_return":
        lines.push(`[${ts}] [thread_return] ${action.content}`);
        lines.push("");
        break;

      case "set_plan":
        lines.push(`[${ts}] [set_plan] ${action.content}`);
        lines.push("");
        break;

      case "action":
        lines.push(`[${ts}] [action]`);
        lines.push(action.content);
        if (action.result) {
          const statusTag = action.success === false ? "x" : "v";
          lines.push(`>>> ${statusTag} ${action.result}`);
        }
        lines.push("");
        break;

      default:
        lines.push(`[${ts}] [${action.type}] ${action.content}`);
        lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * 格式化时间戳为 HH:MM:SS
 */
function formatTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
