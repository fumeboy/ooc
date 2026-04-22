/**
 * 线程 Context 构建器
 *
 * 为每个线程构建独立的 Context，包含执行视角和规划视角。
 * 与旧 builder（kernel/src/context/builder.ts）完全独立。
 *
 * 执行视角：whoAmI + parentExpectation + plan + process + locals + windows
 * 规划视角：children 摘要 + inbox + todos + directory
 *
 * 三种创建方式的 Context 差异（2026-04-22 think/talk 统一后，"sub_thread" 由 think(fork) 产生，"talk" 由 talk(fork/continue) 产生）：
 * - think(fork) / 原 create_sub_thread：初始 process = 父线程渲染快照（inject action）
 * - sub_thread_on_node（协作 API 保留）：初始 process = 空白 + 目标节点完整历史
 * - talk：初始 process = 空白
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#5
 */

import type { StoneData, DirectoryEntry, ContextWindow, TraitDefinition } from "../types/index.js";
import type { SkillDefinition } from "../skill/types.js";
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
import { getBuildFeedback, formatFeedbackForContext } from "../world/hooks.js";
import { existsSync, readFileSync } from "node:fs";
import { join as pathJoin } from "node:path";

/** memory.md 注入 Context 的上限（防止长期记忆膨胀撑爆 Context） */
const MEMORY_MD_MAX_CHARS = 4000;

/**
 * 获取 trait 的完整标识（本地版本，避免循环依赖）
 *
 * 与 activator.traitId 保持一致：`namespace:name`（冒号分隔）。
 */
function localTraitId(trait: TraitDefinition): string {
  return `${trait.namespace}:${trait.name}`;
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

  /* === 创建者信息 === */
  /** 创建者标识（root 线程为 "user"，子线程为创建者线程 ID 或对象名） */
  creator: string;
  /** 创建方式 */
  creationMode: "root" | "sub_thread" | "sub_thread_on_node" | "talk";

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
  /** 已加载的 Skill 定义列表 */
  skills?: SkillDefinition[];
  /**
   * 目标节点数据（仅 sub_thread_on_node 协作场景使用）
   *
   * 当通过 sub_thread_on_node 协作 API 创建子线程时，需要将目标节点的
   * 完整 actions 历史展示在 Context 中。Phase 5 完善具体渲染逻辑。
   */
  targetNodeData?: ThreadDataFile;
}

/**
 * 判断是否为 kernel trait（traitId 前缀匹配）
 *
 * kernel trait 的 readme 注入到 instructions 区域（系统指令），
 * 非 kernel trait 注入到 knowledge 区域（知识窗口）。
 *
 * 新协议：traitId = `namespace:name`，所以用 "kernel:" 前缀判断。
 */
function isKernelTrait(id: string): boolean {
  return id.startsWith("kernel:");
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
    .map(t => ({ name: localTraitId(t), content: t.readme }));

  /* 当前节点的固定集合——给每个知识窗口打 lifespan 标签（pinned / transient） */
  const pinnedSet = new Set(nodeMeta.pinnedTraits ?? []);
  const knowledge: ContextWindow[] = activeTraits
    .filter(t => t.readme && !isKernelTrait(localTraitId(t)))
    .map(t => {
      const fullId = `${t.namespace}:${t.name}`;
      return {
        name: localTraitId(t),
        content: t.readme,
        lifespan: pinnedSet.has(fullId) ? ("pinned" as const) : ("transient" as const),
      };
    });

  if (extraWindows) knowledge.push(...extraWindows);

  /* 动态 context windows（open(type=file) 产生的文件内容窗口） */
  if (threadData.windows) {
    for (const [path, win] of Object.entries(threadData.windows)) {
      knowledge.push({ name: `file:${path}`, content: win.content });
    }
  }

  /* Skill 索引注入 */
  if (input.skills && input.skills.length > 0) {
    knowledge.push({
      name: "available-skills",
      content: formatSkillIndex(input.skills),
    });
  }

  /* SuperFlow（原方案 B Phase 3）：注入对象长期记忆 memory.md
   *
   * super 线程通过 reflective/super.persist_to_memory 写入的经验条目存放在
   * `{stoneDir}/memory.md`。本次 Context 构建时把它作为独立 knowledge 窗口注入，
   * 让主线程 LLM 在思考时"看见"自己沉淀下来的经验。
   *
   * - 只读（主线程不应修改 memory.md，唯一写入路径是 super 分身的沉淀工具）
   * - 上限 4000 字符（超长截取尾部 + 前部提示——偏好近期经验）
   * - 文件不存在 / 读取失败 → 静默跳过（不污染 Context） */
  const stoneDirForMem = paths?.stoneDir;
  if (stoneDirForMem) {
    const memoryPath = pathJoin(stoneDirForMem, "memory.md");
    if (existsSync(memoryPath)) {
      try {
        const raw = readFileSync(memoryPath, "utf-8");
        const content = raw.length > MEMORY_MD_MAX_CHARS
          ? `（…memory.md 超过 ${MEMORY_MD_MAX_CHARS} 字符，已截取最近 ${MEMORY_MD_MAX_CHARS} 字符）\n\n${raw.slice(-MEMORY_MD_MAX_CHARS)}`
          : raw;
        knowledge.push({ name: "memory", content });
      } catch {
        /* 读取失败：静默跳过 */
      }
    }
  }

  /* build_feedback 窗口：注入最近未通过的 build hook 结果
   *
   * 由 `src/world/hooks.ts` 的 runBuildHooks 在 file_ops 类 action 后触发。
   * 这里只负责读当前线程的失败列表，格式化后作为 knowledge 注入。
   * 成功的 hook 不会出现在 getBuildFeedback 返回里；超过 5 分钟自动过期。
   *
   * @ref docs/工程管理/迭代/all/20260422_feature_build_feedback_loop.md
   */
  try {
    const bf = getBuildFeedback(threadId);
    if (bf.length > 0) {
      const content = formatFeedbackForContext(bf);
      if (content) knowledge.push({ name: "build_feedback", content });
    }
  } catch {
    /* 读取 feedback 失败：静默跳过 */
  }

  /* 3. parentExpectation
   *
   * 语义：用当前节点的 title + description 构成"父线程对我的期望"。
   * 为什么用当前节点的 description 而不是父节点的？
   * 因为 description 是父线程在 think(fork) 时指定的，
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

  /* 3b. 线程复活提示 */
  if (nodeMeta.revivalCount && nodeMeta.revivalCount > 0) {
    parentExpectation += `\n<revival_notice>你之前已经完成过此线程（第 ${nodeMeta.revivalCount} 次复活）。你的上一次完成摘要：「${nodeMeta.summary ?? '无'}」。现在你的 inbox 中有新消息需要处理。请阅读新消息并继续工作。</revival_notice>`;
  }

  /* 4. process：渲染 actions 时间线 */
  const process = renderThreadProcess(threadData.actions);

  /* 5. 规划视角 */
  const childrenSummary = renderChildrenSummary(tree, threadId);
  const ancestorSummary = renderAncestorSummary(tree, threadId);
  const siblingSummary = renderSiblingSummary(tree, threadId);
  const inbox = threadData.inbox ?? [];
  const todos = (threadData.todos ?? []).filter(t => t.status === "pending");

  /* 6. locals：从 threadData 读取 */
  const locals: Record<string, unknown> = {};
  if (threadData.locals) Object.assign(locals, threadData.locals);

  /* 7. creator 信息 */
  let creator = "user";
  let creationMode: "root" | "sub_thread" | "sub_thread_on_node" | "talk" = "root";
  if (nodeMeta.creatorObjectName) {
    /* 跨 Object 创建（talk 场景）：creator 是发起 talk 的对象名 */
    creator = nodeMeta.creatorObjectName;
    creationMode = nodeMeta.creationMode ?? "talk";
  } else if (nodeMeta.creatorThreadId && nodeMeta.creatorThreadId !== nodeMeta.parentId) {
    /* sub_thread_on_node（协作 API）：creator 是调用方线程，不是父节点 */
    creator = nodeMeta.creatorThreadId;
    creationMode = nodeMeta.creationMode ?? "sub_thread_on_node";
  } else if (nodeMeta.parentId) {
    /* 普通 think(fork) 子线程：creator 是父线程 */
    creator = nodeMeta.parentId;
    creationMode = nodeMeta.creationMode ?? "sub_thread";
  }
  /* else: root 线程，creator = "user", creationMode = "root" */

  return {
    name: stone.name,
    whoAmI: stone.thinkable.whoAmI,
    parentExpectation,
    plan: threadData.plan ?? "",
    process,
    locals,
    instructions,
    knowledge,
    creator,
    creationMode,
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
  if (actions.length === 0) return "";

  /* 按时间戳排序 */
  const sorted = [...actions].sort((a, b) => a.timestamp - b.timestamp);

  /* 收集已关闭的 form_id（submit 或 close 消费的） */
  const closedFormIds = new Set<string>();
  for (const a of sorted) {
    if (a.type === "tool_use" && a.args?.form_id) {
      if (a.name === "submit" || a.name === "close") {
        closedFormIds.add(a.args.form_id as string);
      }
    }
  }

  /**
   * 判断 action 是否应该被跳过（已关闭 form 的相关记录）
   * - inject 中包含已关闭 form_id 的内容（"Form f_xxx 已创建"、"Form f_xxx 已关闭"）
   * - tool_use open 中 form_id 已关闭的（open 返回的 form_id 在后续被 submit/close）
   */
  function shouldSkipAction(action: ThreadAction): boolean {
    // inject：检查内容是否包含已关闭的 form_id
    if (action.type === "inject") {
      for (const fid of closedFormIds) {
        if (action.content.includes(fid)) return true;
      }
    }
    return false;
  }

  /** 从 tool_use args 中清除 form_id（已关闭的 form） */
  function cleanArgs(action: ThreadAction): Record<string, unknown> | undefined {
    if (!action.args) return action.args;
    const args = { ...action.args };
    if (args.form_id && closedFormIds.has(args.form_id as string)) {
      delete args.form_id;
    }
    return Object.keys(args).length > 0 ? args : undefined;
  }

  const I = "  "; // 缩进单位
  const lines: string[] = [];
  for (const action of sorted) {
    if (shouldSkipAction(action)) continue;

    const ts = formatTimestamp(action.timestamp);
    /* tool_use 的 args 需要清理 form_id */
    const cleanedArgs = action.type === "tool_use" ? cleanArgs(action) : action.args;

    switch (action.type) {
      case "thinking":
        lines.push(`${I}<action type="thinking" ts="${ts}">`);
        lines.push(`${I}${I}${action.content}`);
        lines.push(`${I}</action>`);
        break;

      case "text":
        lines.push(`${I}<action type="text" ts="${ts}">`);
        lines.push(`${I}${I}${action.content}`);
        lines.push(`${I}</action>`);
        break;

      case "tool_use": {
        const nameAttr = action.name ? ` name="${action.name}"` : "";
        lines.push(`${I}<action type="tool_use" ts="${ts}"${nameAttr}>`);
        if (cleanedArgs && Object.keys(cleanedArgs).length > 0) {
          lines.push(`${I}${I}<args>`);
          for (const [k, v] of Object.entries(cleanedArgs)) {
            if (v === undefined || v === null) continue;
            if (typeof v === "object") {
              lines.push(`${I}${I}${I}<${k}>${JSON.stringify(v)}</${k}>`);
            } else {
              lines.push(`${I}${I}${I}<${k}>${v}</${k}>`);
            }
          }
          lines.push(`${I}${I}</args>`);
        }
        lines.push(`${I}</action>`);
        break;
      }

      case "program":
        lines.push(`${I}<action type="program" ts="${ts}"${action.success !== undefined ? ` success="${action.success}"` : ""}>`);
        lines.push(`${I}${I}<code>${action.content}</code>`);
        if (action.result) {
          lines.push(`${I}${I}<result>${action.result}</result>`);
        }
        lines.push(`${I}</action>`);
        break;

      case "inject":
        lines.push(`${I}<action type="inject" ts="${ts}">`);
        lines.push(`${I}${I}${action.content}`);
        lines.push(`${I}</action>`);
        break;

      case "message_in":
        lines.push(`${I}<action type="message_in" ts="${ts}">${action.content}</action>`);
        break;

      case "message_out":
        lines.push(`${I}<action type="message_out" ts="${ts}">${action.content}</action>`);
        break;

      case "create_thread":
        lines.push(`${I}<action type="create_thread" ts="${ts}">${action.content}</action>`);
        break;

      case "thread_return":
        lines.push(`${I}<action type="thread_return" ts="${ts}">${action.content}</action>`);
        break;

      case "set_plan":
        lines.push(`${I}<action type="set_plan" ts="${ts}">${action.content}</action>`);
        break;

      case "mark_inbox":
        lines.push(`${I}<action type="mark_inbox" ts="${ts}">${action.content}</action>`);
        break;

      default:
        lines.push(`${I}<action type="${action.type}" ts="${ts}">${action.content}</action>`);
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

/**
 * 生成 Skill 索引文本
 *
 * 每个 skill 一行，格式：`- name: description (when: 场景)`
 * 用于注入 knowledge window，让对象知道有哪些 skill 可用。
 */
function formatSkillIndex(skills: SkillDefinition[]): string {
  const lines = [
    "## 可用 Skills",
    "",
    "以下 skill 可通过 [use_skill] 指令按需加载完整内容：",
  ];
  for (const s of skills) {
    let line = `- ${s.name}: ${s.description}`;
    if (s.when) line += ` (when: ${s.when})`;
    lines.push(line);
  }
  return lines.join("\n");
}
