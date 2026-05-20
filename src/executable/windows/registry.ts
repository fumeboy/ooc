/**
 * WindowRegistry — 把每种 ContextWindow 类型的"行为契约"集中在这里。
 *
 * 设计依据：docs/superpowers/specs/2026-05-14-context-window-unification-design.md §模型骨架
 *
 * 三个职责（每种 type 各自实现，互不依赖）：
 * 1. commands：该 window 注册的、LLM 可通过 open(parent_window_id, command, ...) 调用的 command 集合
 * 2. onClose：close 触发时的副作用（do_window 的 archive、todo 的标 done 等）
 * 3. renderXml：把该 window 投影成 system context 的 XML 节点（实际 XmlNode 类型由渲染层定义）
 *
 * 注册原则：
 * - 同一 type 的所有 window 实例共享同一份契约（无实例 override）
 * - command 表沿用 src/executable/commands/types.ts 的 CommandTableEntry 形态
 * - 渲染层（src/thinkable/context/render.ts）负责把 renderXml 返回的 XmlNode 串成树
 */

import type { CommandTableEntry } from "./command-types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import type { ContextWindow, WindowType } from "./types.js";

/**
 * close 触发的副作用上下文。
 *
 * - thread：当前 thread；onClose 可直接 mutate（contextWindows 的删除由 WindowManager 统一负责，
 *   onClose 只负责关联状态，比如把子线程切到 archived）
 * - 返回 false 表示拒绝关闭（如初始 creator do_window 不可被 close）；返回 true 或 void 表示允许
 */
export interface OnCloseContext {
  thread: ThreadContext;
  window: ContextWindow;
}

export type OnCloseHook = (ctx: OnCloseContext) => boolean | void;

/**
 * 渲染上下文 — 各 type 把自身字段投影成节点；具体 XmlNode 类型由渲染层 import。
 *
 * 此处只定义最小约束，避免 windows 模块反向依赖渲染层的 XmlNode 类型。
 * 渲染层会在调用前装配 helpers 并消费 unknown 返回值。
 */
export interface RenderContext {
  thread: ThreadContext;
  window: ContextWindow;
}

export type RenderHook = (ctx: RenderContext) => unknown;

/** 单个 window type 的完整契约。 */
export interface WindowTypeDefinition {
  type: WindowType;
  /**
   * 该 window 注册的 command 集合。
   *
   * - root：等于 src/executable/commands 目录全集（do/talk/program/plan/end/todo）
   * - command_exec：空（form 上不能再嵌套 open command）
   * - do：{ continue, wait, close }（具体实现由 windows/do.ts 提供，本注册表填回去）
   * - todo：空（todo 没有可继续的 command；只能 close）
   */
  commands: Record<string, CommandTableEntry>;
  /** close 触发时的副作用；缺省 = 无额外动作，window 直接从 contextWindows 移除。 */
  onClose?: OnCloseHook;
  /** 渲染 hook；缺省时渲染层用通用 fallback。 */
  renderXml?: RenderHook;
  /**
   * 该 window 类型的"基础协议知识"——只要 thread.contextWindows 里出现该 type 的至少
   * 一个实例，就由 collectExecutableKnowledgeEntries 合成为一个 protocol KnowledgeWindow，
   * 让 LLM 在没有任何已 open 的 command_exec 时也知道：
   * - 该 window 注册了哪些 command
   * - 调用形态（open(parent_window_id, command, args)）与典型用法
   *
   * 缺省（undefined）= 不合成；root / command_exec 通常不需要。
   */
  basicKnowledge?: string;
}

/**
 * 全局 window registry。新增 window type 必须在此注册。
 *
 * 当前 step 1 / step 2 范围下的初始注册：
 * - root         — commands 由 windows/root/index.ts 通过 registerWindowType 注入
 * - command_exec — 无 commands、无 onClose（form 的释放语义由 WindowManager 统一处理）
 * - do、todo、talk、program、file、knowledge — 占位空表；具体 commands 与 onClose
 *   由各自 windows/X.ts 在初始化时通过 registerWindowType 注入
 *
 * 这种"先建空表、后注入"的写法避免 windows/registry.ts 直接 import 各 type 实现，
 * 否则会产生 windows ↔ commands ↔ windows 的循环依赖。
 */
const REGISTRY: Map<WindowType, WindowTypeDefinition> = new Map();

REGISTRY.set("root", {
  type: "root",
  commands: {},
});

REGISTRY.set("command_exec", {
  type: "command_exec",
  commands: {},
});

REGISTRY.set("do", {
  type: "do",
  commands: {},
});

REGISTRY.set("todo", {
  type: "todo",
  commands: {},
});

REGISTRY.set("talk", {
  type: "talk",
  commands: {},
});

REGISTRY.set("program", {
  type: "program",
  commands: {},
});

REGISTRY.set("file", {
  type: "file",
  commands: {},
});

REGISTRY.set("knowledge", {
  type: "knowledge",
  commands: {},
});

REGISTRY.set("search", {
  type: "search",
  commands: {},
});

REGISTRY.set("issue", {
  type: "issue",
  commands: {},
});

REGISTRY.set("relation", {
  type: "relation",
  commands: {},
});

/**
 * 替换或合并某 type 的契约，用于 windows/do.ts、windows/todo.ts 在模块加载时注入实现。
 *
 * 合并策略：commands 浅合并（key 冲突时新值覆盖）；onClose / renderXml 直接覆盖。
 */
export function registerWindowType(
  type: WindowType,
  partial: Partial<Omit<WindowTypeDefinition, "type">>,
): void {
  const existing = REGISTRY.get(type);
  if (!existing) {
    throw new Error(`registerWindowType: unknown window type "${type}"`);
  }
  REGISTRY.set(type, {
    ...existing,
    commands: { ...existing.commands, ...(partial.commands ?? {}) },
    onClose: partial.onClose ?? existing.onClose,
    renderXml: partial.renderXml ?? existing.renderXml,
    basicKnowledge: partial.basicKnowledge ?? existing.basicKnowledge,
  });
}

/** 取得指定 type 的契约；未注册时抛错（避免静默吞掉新 type）。 */
export function getWindowTypeDefinition(type: WindowType): WindowTypeDefinition {
  const entry = REGISTRY.get(type);
  if (!entry) {
    throw new Error(`getWindowTypeDefinition: window type "${type}" not registered`);
  }
  return entry;
}

/** 列出所有已注册 type，按字母序返回。 */
export function listRegisteredWindowTypes(): WindowType[] {
  return Array.from(REGISTRY.keys()).sort();
}
