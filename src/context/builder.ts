/**
 * Context 构建器 (G5/G13)
 *
 * 从 Stone 和 Flow 的当前状态构建 Context。
 * 对象不知道 Context 之外的任何事情。
 * G13: 使用认知栈作用域链驱动 trait 激活。
 *
 * @ref docs/哲学文档/gene.md#G5 — implements — Context 构建（whoAmI, process, messages, windows, directory）
 * @ref docs/哲学文档/gene.md#G3 — implements — Trait 激活内容注入 context（instructions + knowledge）
 * @ref docs/哲学文档/gene.md#G9 — references — 行为树渲染为 process 文本
 * @ref docs/哲学文档/gene.md#G13 — implements — 认知栈作用域链驱动 trait 激活
 * @ref src/trait/activator.ts — references — getActiveTraits
 * @ref src/process/cognitive-stack.ts — references — computeScopeChain
 * @ref src/process/render.ts — references — renderProcess 行为树文本渲染
 * @ref src/types/context.ts — references — Context, ContextWindow, WindowConfig 类型
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Context, DirectoryEntry, ContextWindow, WindowConfig, TraitDefinition, TraitTree } from "../types/index.js";
import type { StoneData, FlowData } from "../types/index.js";
import { getActiveTraits, traitId } from "../trait/activator.js";
import { computeScopeChain } from "../process/cognitive-stack.js";
import { renderProcess } from "../process/render.js";
import { findNode } from "../process/tree.js";
import { buildMirror } from "./mirror.js";

/**
 * 构建 Context（G13 认知栈版本）
 *
 * @param stone - 当前 Stone 的数据
 * @param flow - 当前 Flow 的数据
 * @param directory - 系统中所有对象的通讯录
 * @param traits - 已加载的所有 Trait（用于激活判断和内容注入）
 * @param extraWindows - 额外的知识窗口
 * @param stoneDir - Stone 的持久化目录路径（用于解析文件型 window）
 * @param sessionDir - Session 根目录（supervisor 用于构建 session 概览）
 * @returns 完整的 Context
 */
export function buildContext(
  stone: StoneData,
  flow: FlowData,
  directory: DirectoryEntry[],
  traits: TraitDefinition[] = [],
  extraWindows: ContextWindow[] = [],
  stoneDir?: string,
  recentHistory?: string,
  sessionDir?: string,
  flowDir?: string,
  traitTree?: TraitTree[],
): Context {
  /* G13: 从 focus 路径计算作用域链（替代旧的 _activeTraits） */
  const scopeChain = computeScopeChain(flow.process);

  /* 激活 Traits（由作用域链驱动） */
  const activeTraits = getActiveTraits(traits, scopeChain);
  const activeTraitIds = new Set(activeTraits.map(t => traitId(t)));
  const scopeSet = new Set(scopeChain);

  /* Progressive Disclosure: 构建树形 trait catalog */
  const traitCatalog: ContextWindow = {
    name: "_trait_catalog",
    content: renderTraitCatalog(traits, activeTraitIds),
  };

  /* whoAmI 只使用 Stone 自身的 thinkable 描述 */
  const whoAmI = stone.thinkable.whoAmI;

  /* 区分 kernel traits（系统指令）和 user traits（领域知识） */
  const KERNEL_TRAIT_IDS = new Set([
    "kernel/computable",
    "kernel/talkable",
    "kernel/object_creation",
    "kernel/verifiable",
    "kernel/debuggable",
    "kernel/plannable",
    "kernel/reflective",
    "kernel/web_search",
    "kernel/testable",
    "kernel/reviewable",
    "kernel/cognitive-style",
    "kernel/output_format",
  ]);

  /* Progressive Disclosure: 有 description 的 trait 只在 focus 路径或 always-on 时注入完整 readme */
  const instructions: ContextWindow[] = activeTraits
    .filter((t) => t.readme && KERNEL_TRAIT_IDS.has(traitId(t)))
    .filter((t) => !t.description || scopeSet.has(traitId(t)) || t.when === "always")
    .map((t) => ({ name: traitId(t), content: t.readme }));

  const userTraitWindows: ContextWindow[] = activeTraits
    .filter((t) => t.readme && !KERNEL_TRAIT_IDS.has(traitId(t)))
    .filter((t) => !t.description || scopeSet.has(traitId(t)))
    .map((t) => ({ name: traitId(t), content: t.readme }));

  /* 解析 Flow 中的动态 windows */
  const dynamicWindows = resolveDynamicWindows(flow, stoneDir);

  /* Mirror：行为观察窗口 */
  const mirrorWindows: ContextWindow[] = [];
  const mirror = buildMirror(flow, stone);
  if (mirror) mirrorWindows.push({ name: "mirror", content: mirror });

  /* Session Overview：supervisor 专用，展示所有 sub-flow 状态 */
  const sessionWindows: ContextWindow[] = [];
  if (stone.name === "supervisor" && sessionDir) {
    const overview = buildSessionOverview(sessionDir, stone.name);
    if (overview !== "(no active flows)") {
      sessionWindows.push({ name: "_session_overview", content: overview });
    }
    const msgTimeline = buildSessionMessages(sessionDir, stone.name);
    if (msgTimeline) {
      sessionWindows.push({ name: "_session_messages", content: msgTimeline });
    }
  }

  /* Memory：长期记忆 + 会话记忆 + 历史对话摘要 */
  const memoryWindows: ContextWindow[] = [];
  if (stone.memory) memoryWindows.push({ name: "long-term-memory", content: stone.memory });
  if (flow.memory) memoryWindows.push({ name: "session-memory", content: flow.memory });
  if (recentHistory) memoryWindows.push({ name: "recent-conversations", content: recentHistory });

  /* 结构化遗忘：只展示 focus 节点的 actions */
  const actions = selectActionsForContext(flow);

  /* 路径变量（注入到 STATUS 区域，让对象知道自己的物理位置） */
  const paths: Record<string, string> | undefined = stoneDir ? {
    self_dir: stoneDir,
    self_files_dir: join(stoneDir, "files"),
    self_traits_dir: join(stoneDir, "traits"),
    world_dir: join(stoneDir, "..", ".."),
    task_dir: flowDir ?? "",
    task_files_dir: flowDir ? join(flowDir, "files") : "",
  } : undefined;

  return {
    name: stone.name,
    whoAmI,
    process: renderProcess(flow.process),
    messages: flow.messages,
    actions,
    instructions,
    knowledge: [traitCatalog, ...memoryWindows, ...userTraitWindows, ...extraWindows, ...dynamicWindows, ...mirrorWindows, ...sessionWindows],
    directory: directory.filter((d) => d.name !== stone.name),
    status: flow.status,
    paths,
  };
}

/**
 * 结构化遗忘：选择应该出现在 Context 中的 actions
 *
 * 返回当前 focus 节点的 actions。
 * 当 focus 移动到新节点时，旧节点的详细 actions 被"遗忘"，
 * 只在 PROCESS 区域以 summary 形式保留。
 */
function selectActionsForContext(flow: FlowData) {
  const focusNode = findNode(flow.process.root, flow.process.focusId);
  return focusNode?.actions ?? [];
}

/**
 * 渲染树形 trait_catalog
 *
 * 核心规则（Progressive Disclosure）：
 * - Active always-on 父 trait 的所有子 trait 描述自动可见（Level 2）
 * - inactive parent 折叠展示（只提示可激活）
 * - 树形缩进展示层级关系
 */
function renderTraitCatalog(
  allTraits: TraitDefinition[],
  activeTraitIds: Set<string>,
): string {
  const lines: string[] = [
    "## Available Traits",
    "",
    "Use this catalog to discover capabilities.",
    "Traits listed under Inactive are still available; readTrait(name) to view, activateTrait(name) to inject.",
    "",
  ];

  // 找出根 trait（没有 parent 的）
  const rootTraits = allTraits.filter((t) => !t.parent);

  // 分离 active 和 inactive 根 trait
  const rootActive = rootTraits.filter((t) => activeTraitIds.has(traitId(t)));
  const rootInactive = rootTraits.filter((t) => !activeTraitIds.has(traitId(t)));

  if (rootActive.length > 0) {
    lines.push("### Active");
    for (const t of rootActive) {
      const desc = t.description || t.name;
      lines.push(`- ${traitId(t)}: ${desc}`);
      // 展开所有子 trait（active + inactive），因为父 trait 是 always-on
      const allChildren = allTraits.filter((t2) => t2.parent === traitId(t));
      for (const child of allChildren) {
        const childDesc = child.description || child.name;
        lines.push(`  → ${traitId(child)}: ${childDesc}`);
      }
    }
    lines.push("");
  }

  if (rootInactive.length > 0) {
    lines.push("### Inactive (activateTrait to enable)");
    for (const t of rootInactive) {
      const desc = t.description || t.name;
      const hasChildren = allTraits.some((t2) => t2.parent === traitId(t));
      if (hasChildren) {
        lines.push(`- ${traitId(t)}: ${desc} → activateTrait to see sub-traits`);
      } else {
        lines.push(`- ${traitId(t)}: ${desc} (activateTrait to use)`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * 解析 Flow 中的动态 windows 配置
 *
 * 从 flow.data._windows 读取 WindowConfig，按类型解析为 ContextWindow：
 * - static: 直接使用 content
 * - file: 读取文件内容（相对于 stoneDir）
 * - function: 标记为函数型（实际调用在 ThinkLoop 中完成）
 */
function resolveDynamicWindows(flow: FlowData, stoneDir?: string): ContextWindow[] {
  const windowConfigs = flow.data._windows as Record<string, WindowConfig> | undefined;
  if (!windowConfigs) return [];

  const results: ContextWindow[] = [];

  for (const [name, cfg] of Object.entries(windowConfigs)) {
    if (!cfg || typeof cfg !== "object") continue;

    if (cfg.type === "static" && typeof cfg.content === "string") {
      results.push({ name, content: cfg.content });
    } else if (cfg.type === "file" && typeof cfg.filePath === "string" && stoneDir) {
      const filePath = join(stoneDir, cfg.filePath);
      if (existsSync(filePath)) {
        results.push({ name, content: readFileSync(filePath, "utf-8") });
      }
    } else if (cfg.type === "function" && cfg.traitName && cfg.methodName) {
      /* 函数型 window：标记来源，实际内容需要在 ThinkLoop 中调用方法获取 */
      results.push({ name, content: `[动态内容: ${cfg.traitName}.${cfg.methodName}()]` });
    }
  }

  return results;
}

/**
 * 构建 session 概览（supervisor 专用）
 *
 * 读取 session 中所有 sub-flow 的 process.json，排除 supervisor 自身，
 * 生成各 flow 的状态摘要，帮助 supervisor 掌握全局进展。
 *
 * @param sessionDir - session 根目录（如 flows/{sessionId}/）
 * @param supervisorName - supervisor 的 stone 名称（排除自身）
 * @returns 格式化的概览文本
 */
export function buildSessionOverview(sessionDir: string, supervisorName: string): string {
  const objectsDir = join(sessionDir, "objects");
  if (!existsSync(objectsDir)) return "(no active flows)";

  let dirNames: string[];
  try {
    const entries = readdirSync(objectsDir, { withFileTypes: true });
    dirNames = entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return "(no active flows)";
  }

  const lines: string[] = ["## Session Overview\n"];

  for (const name of dirNames) {
    if (name === supervisorName) continue;

    const processPath = join(objectsDir, name, "process.json");
    if (!existsSync(processPath)) continue;

    try {
      const raw = readFileSync(processPath, "utf-8");
      const process = JSON.parse(raw);
      const root = process.root;
      if (!root) continue;

      const status = root.status ?? "unknown";
      const title = root.title ?? name;
      const focusId = process.focusId ?? "?";
      const childCount = root.children?.length ?? 0;

      lines.push(`### ${name}`);
      lines.push(`- status: ${status}`);
      lines.push(`- task: ${title}`);
      lines.push(`- focus: ${focusId}`);
      lines.push(`- subtasks: ${childCount}`);

      /* 展示直接子节点摘要（最多 5 个） */
      if (root.children && root.children.length > 0) {
        for (const child of root.children.slice(0, 5)) {
          const childStatus = child.status ?? "?";
          const childTitle = child.title ?? "untitled";
          const childSummary = child.summary ? ` — ${child.summary.slice(0, 60)}` : "";
          lines.push(`  - [${childStatus}] ${childTitle}${childSummary}`);
        }
        if (root.children.length > 5) {
          lines.push(`  - ... and ${root.children.length - 5} more`);
        }
      }
      lines.push("");
    } catch {
      /* 跳过格式错误的 process.json */
    }
  }

  return lines.length <= 1 ? "(no active flows)" : lines.join("\n");
}

/**
 * 构建 Session 内所有对象的消息时间线
 *
 * 读取 session 内所有 sub-flow 的 messages，按时间排序合并，
 * 让 supervisor 能看到与用户一样的全局消息视图。
 *
 * @param sessionDir - session 根目录
 * @param supervisorName - supervisor 名称（不排除，supervisor 自己的消息也要看到）
 * @returns 格式化的消息时间线文本，无消息时返回 null
 */
export function buildSessionMessages(sessionDir: string, supervisorName: string): string | null {
  const objectsDir = join(sessionDir, "objects");
  if (!existsSync(objectsDir)) return null;

  let dirNames: string[];
  try {
    const entries = readdirSync(objectsDir, { withFileTypes: true });
    dirNames = entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return null;
  }

  interface Msg { from: string; to: string; content: string; timestamp: number }
  const allMessages: Msg[] = [];
  const seen = new Set<string>();

  for (const name of dirNames) {
    const dataPath = join(objectsDir, name, "data.json");
    if (!existsSync(dataPath)) continue;

    try {
      const raw = readFileSync(dataPath, "utf-8");
      const data = JSON.parse(raw);
      const messages = data.messages as Msg[] | undefined;
      if (!messages || !Array.isArray(messages)) continue;

      for (const msg of messages) {
        /* 去重：同一条消息可能在 sender 和 receiver 的 flow 中都有 */
        const key = `${msg.from}|${msg.to}|${msg.timestamp}`;
        if (seen.has(key)) continue;
        seen.add(key);
        allMessages.push(msg);
      }
    } catch {
      /* 跳过格式错误的 data.json */
    }
  }

  if (allMessages.length === 0) return null;

  /* 按时间排序 */
  allMessages.sort((a, b) => a.timestamp - b.timestamp);

  /* 格式化为时间线 */
  const lines = allMessages.map((msg) => {
    const time = new Date(msg.timestamp).toLocaleTimeString("zh-CN", { hour12: false });
    const content = msg.content.length > 200 ? msg.content.slice(0, 200) + "..." : msg.content;
    return `[${time}] ${msg.from} → ${msg.to}: ${content}`;
  });

  return `## Session Messages\n\n${lines.join("\n")}`;
}
