/**
 * 线程 Context 构建器
 *
 * 为每个线程构建独立的 Context，包含执行视角和规划视角。
 * 这是 ThreadTree 引擎的唯一 Context 构建入口。
 *
 * 执行视角：whoAmI + parentExpectation + plan + processEvents + locals + windows
 * 规划视角：children 摘要 + inbox + todos + directory
 *
 * 三种创建方式的 Context 差异（2026-04-22 do/talk 统一后，"sub_thread" 由 do(fork) 产生，"talk" 由 talk(fork/continue) 产生）：
 * - do(fork) / 原 create_sub_thread：初始 processEvents 包含父线程渲染快照（inject event）
 * - sub_thread_on_node（协作 API 保留）：初始 processEvents = 空白 + 目标节点完整历史
 * - talk：初始 processEvents = 空白
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#5
 */

import type { StoneData, DirectoryEntry, ContextWindow, TraitDefinition } from "../../shared/types/index.js";
import type { SkillDefinition } from "../../extendable/skill/types.js";
import type {
  ThreadsTreeFile,
  ThreadDataFile,
  ProcessEvent,
  ThreadInboxMessage,
  ThreadTodoItem,
  ThreadStatus,
} from "../../thinkable/thread-tree/types.js";
import { getAncestorPath } from "../../storable/thread/persistence.js";
import { resolveTraitRef } from "../../extendable/knowledge/activator.js";
import { getOpenFiles } from "../../extendable/activation/open-files.js";
import { scanPeers } from "../../collaborable/relation/peers.js";
import { readPeerRelations, type PeerRelationEntry } from "../../collaborable/relation/relation.js";
import { detectSelfKind } from "../../object/self-kind.js";
import { getBuildFeedback, formatFeedbackForContext } from "../../world/hooks.js";
import { getLatestCoverage } from "../../observable/test-runner/runner.js";
import { serializeXml, type XmlNode } from "../../executable/protocol/xml.js";
import { existsSync, readFileSync } from "node:fs";
import { join as pathJoin } from "node:path";

/** memory.md 注入 Context 的上限（防止长期记忆膨胀撑爆 Context） */
const MEMORY_MD_MAX_CHARS = 4000;

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
  /** process events：当前线程上下文变化与 LLM 交互历史 */
  processEvents: ProcessEvent[];
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

  /**
   * <relations> 索引条目（Phase 5 新增）
   *
   * 由 target 阶段扫描当前线程 peers + 读取 relations/ 文件降级链生成。
   * 空数组表示无 peer，调用方可省略整个块；每项含 peer name + 索引行摘要 +
   * hasFile 标记（可用于区分缺失与存在但空）。XML 渲染在 engine 的
   * contextToMessages 里完成，便于与其他 user 子节点统一缩进。
   */
  relations: PeerRelationEntry[];
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
   * 完整 events 历史展示在 Context 中。Phase 5 完善具体渲染逻辑。
   */
  targetNodeData?: ThreadDataFile;
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

  /* 1+2. Open-files 中枢：scope chain + deps 递归激活
   *
   * Phase 3 重构：把 scopeChain + getActiveTraits 折叠进 getOpenFiles，
   * 它返回 { pinned, transient, inject, instructions, knowledge, activeTraitIds }。
   *
   * lifespan 语义：
   * - kernel:base 是协议基座，等价 pinned，不随 command form 生命周期回收
   * - open-files 已把 stoneRefs + nodeMeta.pinnedTraits + kernel:base 统一归到
   *   pinned 集合，直接沿用其 lifespan 即可 */
  const stoneTraitRefs = extractStoneTraitRefs(stone, traits);
  const scopeChain = computeThreadScopeChain(tree, threadId, stoneTraitRefs);
  const openFiles = getOpenFiles({ tree, threadId, threadData, stone, traits });

  /* kernel trait → instructions（无 lifespan 标签；但保留 source 用于 hover 溯源） */
  const instructions: ContextWindow[] = openFiles.instructions.map(w => ({
    name: w.name,
    content: w.content,
    source: w.source,
  }));

  /* 非 kernel trait → knowledge：直接沿用 open-files 计算的 lifespan / source */
  const knowledge: ContextWindow[] = openFiles.knowledge.map(w => ({
    name: w.name,
    content: w.content,
    lifespan: w.lifespan,
    source: w.source,
  }));

  if (extraWindows) {
    /* extraWindows 的来源归到 "extra"（调用方注入），除非调用方已标注 source */
    for (const w of extraWindows) {
      knowledge.push({ ...w, source: w.source ?? "extra" });
    }
  }

  /* 动态 context windows（open(type=file) 产生的文件内容窗口） */
  if (threadData.windows) {
    for (const [path, win] of Object.entries(threadData.windows)) {
      knowledge.push({ name: `file:${path}`, content: win.content, source: "file_window" });
    }
  }

  /* Skill 索引注入 */
  if (input.skills && input.skills.length > 0) {
    knowledge.push({
      name: "available-skills",
      content: formatSkillIndex(input.skills),
      source: "skill_index",
    });
  }

  /* SuperFlow（原方案 B Phase 3）：注入对象长期记忆
   *
   * 老版：`{stoneDir}/memory.md`（append-only markdown snapshot）
   * 新版（Memory Curation 2026-04-22）：`{stoneDir}/memory/index.md` + `{stoneDir}/memory/entries/*.json`
   *
   * 注入策略（最小侵入）：
   * 1. 优先读 `memory/index.md`（结构化 curated 视图；Top Pinned + Recent）
   * 2. 若无 → 回退 `memory.md`（老路径，Bruce 测试等用例依赖）
   * 3. 两者都无 → 静默跳过
   *
   * - 只读（主线程不应修改 memory，唯一写入路径是 super 分身的沉淀工具）
   * - 上限 MEMORY_MD_MAX_CHARS（超长截取尾部）
   * - 读取失败 → 静默跳过（不污染 Context） */
  const stoneDirForMem = paths?.stoneDir;
  if (stoneDirForMem) {
    const indexPath = pathJoin(stoneDirForMem, "memory", "index.md");
    const legacyPath = pathJoin(stoneDirForMem, "memory.md");
    const sourcePath = existsSync(indexPath)
      ? indexPath
      : existsSync(legacyPath)
        ? legacyPath
        : null;
    if (sourcePath) {
      try {
        const raw = readFileSync(sourcePath, "utf-8");
        const content = raw.length > MEMORY_MD_MAX_CHARS
          ? `（…memory 超过 ${MEMORY_MD_MAX_CHARS} 字符，已截取最近 ${MEMORY_MD_MAX_CHARS} 字符）\n\n${raw.slice(-MEMORY_MD_MAX_CHARS)}`
          : raw;
        knowledge.push({ name: "memory", content, source: "memory" });
      } catch {
        /* 读取失败：静默跳过 */
      }
    }
  }

  /* coverage 窗口：注入最近一次 --coverage 跑出的摘要
   *
   * 由 `src/observable/test-runner/runner.ts` 的 runTests(opts.coverage=true) 更新缓存。
   * 只显示总覆盖率 + 文件表摘要（前 20 行），让 LLM 知道哪些新代码缺测试。
   * 从未跑过 coverage 时 getLatestCoverage 返回 undefined，不注入窗口。
   *
   * @ref docs/工程管理/迭代/all/20260422_feature_feedback_loop_完整闭环.md
   */
  try {
    const cov = getLatestCoverage();
    if (cov && (cov.summary || typeof cov.pct === "number")) {
      const header = typeof cov.pct === "number"
        ? `# Coverage — 总覆盖率 ${cov.pct}% (cwd=${cov.cwd})`
        : `# Coverage (cwd=${cov.cwd})`;
      const body = cov.summary || "(无文件级表，仅总览)";
      knowledge.push({ name: "coverage", content: `${header}\n\n${body}`, source: "coverage" });
    }
  } catch {
    /* 读取失败静默跳过 */
  }

  /* build_feedback 窗口：注入最近未通过的 build hook 结果
   *
   * 由 `src/world/hooks.ts` 的 runBuildHooks 在 file_ops 类 event 后触发。
   * 这里只负责读当前线程的失败列表，格式化后作为 knowledge 注入。
   * 成功的 hook 不会出现在 getBuildFeedback 返回里；超过 5 分钟自动过期。
   *
   * @ref docs/工程管理/迭代/all/20260422_feature_build_feedback_loop.md
   */
  try {
    const bf = getBuildFeedback(threadId);
    if (bf.length > 0) {
      const content = formatFeedbackForContext(bf);
      if (content) knowledge.push({ name: "build_feedback", content, source: "build_feedback" });
    }
  } catch {
    /* 读取 feedback 失败：静默跳过 */
  }

  /* 3. parentExpectation
   *
   * 语义：当前节点自身的 title + description，描述"我被要求做什么"。
   * title 是 do(fork) 时由父线程指定的子线程任务名称（即 <task> 的核心内容）。
   * description 是对任务的补充说明，同样来自父线程创建子线程时传入的参数。
   *
   * BUG-C 修复（Symptom 2）：之前错误地使用了 parent.title（父线程自身的任务名），
   * 导致子线程的 <task> 渲染的是父线程的任务标题，而非自己被分配的任务标题。
   * 例如：submit(title="分析 G3 基因") 创建的子线程，其 <task> 应显示"分析 G3 基因"，
   * 而不是"supervisor 主线程"（父线程的 title）。
   * 父线程的上下文已通过 <creator> 和 <ancestor_summary> 提供，无需重复写入 <task>。
   */
  let parentExpectation = "";
  if (nodeMeta.parentId) {
    /* 有父节点：说明这是子线程，用自身 title 作为 <task> 核心内容 */
    parentExpectation = nodeMeta.title;
    if (nodeMeta.description) {
      parentExpectation += `\n${nodeMeta.description}`;
    }
  }

  /* 3b. 线程复活提示 */
  if (nodeMeta.revivalCount && nodeMeta.revivalCount > 0) {
    parentExpectation += `\n<revival_notice>你之前已经完成过此线程（第 ${nodeMeta.revivalCount} 次复活）。你的上一次完成摘要：「${nodeMeta.summary ?? '无'}」。现在你的 inbox 中有新消息需要处理。请阅读新消息并继续工作。</revival_notice>`;
  }

  /* 4. process events：当前线程上下文变化与 LLM 交互历史 */
  const processEvents = threadData.events;

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
    /* 普通 do(fork) 子线程：creator 是父线程 */
    creator = nodeMeta.parentId;
    creationMode = nodeMeta.creationMode ?? "sub_thread";
  }
  /* else: root 线程，creator = "user", creationMode = "root" */

  /* 8. <relations> 索引条目（Phase 5/7 target 阶段）
   *
   * 扫描当前线程涉及的 peer 对象，读 relations/{peer}.md 的 summary 降级链
   * 生成结构化条目。XML 渲染由 engine.contextToMessages 负责。
   * Phase 7：通过 detectSelfKind 识别 stone vs flow_obj，flow_obj 时 relation
   *          文件位于 flows/<sid>/objects/<self>/relations/ 下。 */
  let relations: PeerRelationEntry[] = [];
  const rootDir = paths?.rootDir;
  if (rootDir) {
    const peers = scanPeers(threadData, stone.name);
    const stoneDir = paths?.stoneDir ?? "";
    const flowsDir = paths?.flowsDir ?? (rootDir ? `${rootDir}/flows` : "");
    const selfInfo = detectSelfKind(stoneDir, flowsDir);
    relations = readPeerRelations(peers, {
      rootDir,
      selfName: stone.name,
      selfKind: selfInfo.selfKind,
      sessionId: selfInfo.sessionId,
    });
  }

  return {
    name: stone.name,
    whoAmI: stone.thinkable.whoAmI,
    parentExpectation,
    plan: threadData.plan ?? "",
    processEvents,
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
    relations,
  };
}

/**
 * 沿祖先链计算 scope chain（合并所有 traits + activatedTraits）
 *
 * 复用阶段 1 的 getAncestorPath（返回 Root → leaf 顺序），
 * 保证 scope chain 的遍历顺序与 spec Section 5.3 一致：
 * Root 的 traits 在前，leaf 的 traits 在后。
 *
 * 额外：stoneRefs（来自 stone.data._traits_ref 的已解析 traitId 列表）
 * 作为对象级"默认激活"清单，优先合入 scope chain（位于所有线程自身
 * traits 之前），便于在线程层级未显式声明时仍能激活这些 trait。
 *
 * @param tree - 线程树
 * @param nodeId - 目标节点 ID
 * @param stoneRefs - 对象级默认激活的 trait id 列表（可选，完整 namespace:name 格式）
 * @returns 去重后的 trait 名称列表（Root → leaf 顺序）
 */
export function computeThreadScopeChain(
  tree: ThreadsTreeFile,
  nodeId: string,
  stoneRefs?: string[],
): string[] {
  const path = getAncestorPath(tree, nodeId); /* Root → leaf 顺序 */
  const seen = new Set<string>();
  const result: string[] = [];

  /* 对象级默认激活：优先合入，保证"对象默认可用的 trait"始终在所有线程层之前 */
  if (stoneRefs && stoneRefs.length > 0) {
    for (const t of stoneRefs) {
      if (!seen.has(t)) { seen.add(t); result.push(t); }
    }
  }

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
 * 从 stone.data._traits_ref 中提取对象级默认激活清单
 *
 * `_traits_ref` 是 stone 声明的"对象默认激活 trait 列表"——
 * 即无需线程层显式激活就默认生效的 trait（例如 supervisor 总是可用
 * git/review/memory 等高阶工具）。
 *
 * 支持两种书写：
 * 1. 完整 namespace:name 形式（推荐）—— "kernel:reviewable/review_api"
 * 2. 简写 name 形式 —— "git_ops"、"reviewable/review_api"（按 self/kernel/library 优先级 resolve）
 *
 * 未命中 available traits 的 ref 会被静默忽略（避免历史数据污染 scope chain）。
 *
 * @param stone - Stone 数据（其 data._traits_ref 可选）
 * @param traits - 已加载的所有 trait（用于 resolveTraitRef 候选集合）
 * @returns 去重后的完整 traitId 列表
 */
export function extractStoneTraitRefs(
  stone: StoneData,
  traits: TraitDefinition[],
): string[] {
  const raw = (stone.data as Record<string, unknown> | undefined)?._traits_ref;
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || item.length === 0) continue;
    const resolved = resolveTraitRef(item, traits);
    if (!resolved) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
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
 * 渲染线程 process events 时间线（执行视角的 process）
 *
 * 按时间戳排序，格式化为 LLM 可读的文本。
 * 与旧 renderProcess 的区别：不需要行为树结构，直接渲染事件列表。
 *
 * @param events - 线程的 process events 列表
 * @returns 渲染后的文本
 */
export function renderThreadProcess(events: ProcessEvent[]): string {
  if (events.length === 0) return "";

  /* 按时间戳排序——compact_summary 依赖被强制置为 min(ts)-1 排在最前 */
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

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
   * 判断 process event 是否应该被跳过（已关闭 form 的相关记录）
   * - inject 中包含已关闭 form_id 的内容（"Form f_xxx 已创建"、"Form f_xxx 已关闭"）
   * - tool_use open 中 form_id 已关闭的（open 返回的 form_id 在后续被 submit/close）
   */
  function shouldSkipEvent(event: ProcessEvent): boolean {
    // inject：检查内容是否包含已关闭的 form_id
    if (event.type === "inject") {
      for (const fid of closedFormIds) {
        if (event.content.includes(fid)) return true;
      }
    }
    return false;
  }

  /** 从 tool_use args 中清除 form_id（已关闭的 form）
   *
   * 注意：历史里不展示真实 form_id 是刻意设计——已完结的 form_id 属于历史残留，
   * 继续展示可能误导后续判断。
   * 但为了避免模型被"历史缺失 form_id"误导（规则要 form_id，历史却没有），
   * 这里输出一个展示层占位符字段 `form_id_finished_so_removed`，明确表示：
   * 此 event 曾有关联 form_id，但已在完成后移除。
   *
   * 运行时永远不依赖该字段；它只存在于 Context 渲染/落盘（llm.input.txt）。
   */
  function cleanArgs(event: ProcessEvent): Record<string, unknown> | undefined {
    if (!event.args) return event.args;
    const args = { ...event.args };
    if (args.form_id && closedFormIds.has(args.form_id as string)) {
      delete args.form_id;
      (args as Record<string, unknown>).form_id_finished_so_removed = true;
    }
    return Object.keys(args).length > 0 ? args : undefined;
  }

  /** 把任意 JS value 转成 XmlNode，避免 JSON.stringify 塞进文本内容
   *
   * - 标量（string/number/boolean）→ 叶子 content
   * - 数组 → `<tag><item index="0">...</item><item index="1">...</item></tag>`
   * - 对象 → `<tag><key1>...</key1><key2>...</key2></tag>`（键按字典序）
   * - null/undefined → 返回 null，调用方决定是否忽略
   */
  function valueToXmlNode(tag: string, value: unknown): XmlNode | null {
    if (value === undefined || value === null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return { tag, content: String(value) };
    }
    if (Array.isArray(value)) {
      const children: XmlNode[] = [];
      for (let i = 0; i < value.length; i++) {
        const child = valueToXmlNode("item", value[i]);
        if (child) {
          child.attrs = { ...(child.attrs ?? {}), index: i };
          children.push(child);
        }
      }
      return { tag, children };
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
      const children: XmlNode[] = [];
      for (const k of keys) {
        const child = valueToXmlNode(k, obj[k]);
        if (child) children.push(child);
      }
      return { tag, children };
    }
    return { tag, content: String(value) };
  }

  const nodes: XmlNode[] = [];
  for (const event of sorted) {
    if (shouldSkipEvent(event)) continue;

    const ts = formatTimestamp(event.timestamp);
    const cleanedArgs = event.type === "tool_use" ? cleanArgs(event) : event.args;

    const attrs: Record<string, string | number> = { type: event.type, ts };
    if (event.type === "tool_use" && event.name) attrs.name = event.name;
    if (event.type === "program" && event.success !== undefined) attrs.success = String(event.success);
    if (event.type === "compact_summary") {
      if (typeof event.original === "number") attrs.original = event.original;
      if (typeof event.kept === "number") attrs.kept = event.kept;
    }

    const node: XmlNode = { tag: "action", attrs };

    switch (event.type) {
      case "tool_use": {
        if (cleanedArgs && Object.keys(cleanedArgs).length > 0) {
          const argKeys = Object.keys(cleanedArgs).sort((a, b) => a.localeCompare(b));
          const argChildren: XmlNode[] = [];
          for (const k of argKeys) {
            const v = (cleanedArgs as Record<string, unknown>)[k];
            const argNode = valueToXmlNode(k, v);
            if (argNode) argChildren.push(argNode);
          }
          node.children = [{ tag: "args", children: argChildren }];
        } else {
          node.selfClosing = true;
        }
        break;
      }
      case "program": {
        const children: XmlNode[] = [{ tag: "code", content: event.content }];
        if (event.result) children.push({ tag: "result", content: event.result });
        node.children = children;
        break;
      }
      case "compact_summary": {
        /* 压缩摘要作为首条历史背景渲染——LLM 看到后会理解"此前这一大片经历被 compact 掉了"，
         * 并在 summary 里获取整体情境。original/kept 已进 attrs。 */
        node.content = `[已压缩 · 此前历史的浓缩摘要]\n${event.content}`;
        break;
      }
      default: {
        if (event.content) {
          node.content = event.content;
        } else {
          node.selfClosing = true;
        }
      }
    }

    nodes.push(node);
  }

  /* depth=1：让 <action> 相对外层 <process> 缩进 2 空格 */
  return serializeXml(nodes, 1);
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
