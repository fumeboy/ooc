/**
 * WindowRegistry — 把每种 ContextWindow 类型的"行为契约"集中在这里。
 *
 * 设计依据：docs/superpowers/specs/2026-05-14-context-window-unification-design.md §模型骨架
 *
 * 三个职责（每种 type 各自实现，互不依赖）：
 * 1. methods：该 window 注册的、LLM 可通过 open(parent_window_id, command, ...) 调用的 method 集合
 * 2. onClose：close 触发时的副作用（do_window 的 archive 等）
 * 3. renderXml：把该 window 投影成 system context 的 XML 节点（实际 XmlNode 类型由渲染层定义）
 *
 * 注册原则：
 * - 同一 type 的所有 window 实例共享同一份契约（无实例 override）
 * - method 表沿用 src/executable/commands/types.ts 的 MethodEntry 形态
 * - 渲染层（src/thinkable/context/render.ts）负责把 renderXml 返回的 XmlNode 串成树
 */

import type { MethodEntry } from "./method-types.js";
import type { ThreadContext } from "../../../thinkable/context.js";
import type { XmlNode } from "../../../thinkable/context/xml.js";
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
 * 渲染上下文 — 各 type 把自身字段投影成"window 外壳内的子节点序列"。
 *
 * 契约（根因 #4 接口 explicit）：
 * - renderXml 返回 `XmlNode[]`（同步或异步）——即 `<window ...>` 包裹下的 children
 * - 通用层（render.ts）负责外壳 / title / commands / sub_windows 折叠 / sharing 属性
 * - 每个 builtin window type 必须实现 renderXml；注册期 fail-loud 见 registerWindowType
 *
 * thread 字段始终非 undefined（即便是 in-memory 测试 thread 也会构造空 inbox/outbox），
 * 各 hook 通过 ctx.thread 拿到完整 ThreadContext（含 inbox/outbox/persistence/...）。
 */
export interface RenderContext {
  thread: ThreadContext;
  window: ContextWindow;
}

export type RenderHook = (ctx: RenderContext) => XmlNode[] | Promise<XmlNode[]>;

/**
 * 压缩视图渲染 hook（design: docs/2026-05-25-context-compression-design.md §4.1）。
 *
 * 与 RenderHook 同协议:返回"<window> 外壳内的子节点序列",render.ts 调度器在
 * window.compressLevel ≥ 1 时按 type 派发到本 hook。
 *
 * 本 phase(P0b) 各 builtin type 暂不强制实现,缺省时 render.ts 走通用 fallback
 * (仅输出 `<compressed>` 元节点);P0c 起逐个 type 注册具体 compressView。
 */
export type CompressViewHook = (
  ctx: RenderContext,
  level: 1 | 2,
) => XmlNode[] | Promise<XmlNode[]>;

/** 单个 window type 的完整契约。 */
export interface WindowTypeDefinition {
  type: WindowType;
  /**
   * 该 window 注册的 method 集合。
   *
   * - root：等于 src/executable/commands 目录全集（do/talk/program/plan/end/todo_*）
   * - command_exec：空（form 上不能再嵌套 open command）
   * - do：{ continue, wait, close }（具体实现由 windows/do.ts 提供，本注册表填回去）
   */
  methods: Record<string, MethodEntry>;
  /** close 触发时的副作用；缺省 = 无额外动作，window 直接从 contextWindows 移除。 */
  onClose?: OnCloseHook;
  /** 渲染 hook；缺省时渲染层用通用 fallback。 */
  renderXml?: RenderHook;
  /**
   * 压缩态渲染 hook;缺省时 render.ts 在 compressLevel ≥ 1 时走通用 fallback
   * (title + `<compressed level=N>` + `<commands hint="expand">`)。
   * P0c 起各 builtin type 按需注册具体的 folded / snapshot 渲染。
   */
  compressView?: CompressViewHook;
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
 * - do、talk、program、file、knowledge — 占位空表；具体 commands 与 onClose
 *   由各自 windows/X.ts 在初始化时通过 registerWindowType 注入
 *
 * 这种"先建空表、后注入"的写法避免 windows/registry.ts 直接 import 各 type 实现，
 * 否则会产生 windows ↔ commands ↔ windows 的循环依赖。
 */
const REGISTRY: Map<WindowType, WindowTypeDefinition> = new Map();

REGISTRY.set("root", {
  type: "root",
  methods: {},
});

REGISTRY.set("command_exec", {
  type: "command_exec",
  methods: {},
});

REGISTRY.set("do", {
  type: "do",
  methods: {},
});

REGISTRY.set("talk", {
  type: "talk",
  methods: {},
});

REGISTRY.set("program", {
  type: "program",
  methods: {},
});

REGISTRY.set("file", {
  type: "file",
  methods: {},
});

REGISTRY.set("knowledge", {
  type: "knowledge",
  methods: {},
});

REGISTRY.set("search", {
  type: "search",
  methods: {},
});

REGISTRY.set("relation", {
  type: "relation",
  methods: {},
});

REGISTRY.set("custom", {
  type: "custom",
  methods: {},
});

REGISTRY.set("skill_index", {
  type: "skill_index",
  methods: {},
});

REGISTRY.set("feishu_chat", {
  type: "feishu_chat",
  methods: {},
});

REGISTRY.set("feishu_doc", {
  type: "feishu_doc",
  methods: {},
});

/**
 * 替换或合并某 type 的契约，用于 windows/do.ts 等在模块加载时注入实现。
 *
 * 合并策略：methods 浅合并（key 冲突时新值覆盖）；onClose / renderXml 直接覆盖。
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
    // 直接替换不展开:custom window 用 Proxy 做 dynamic dispatcher,
    // 展开 (...) 会触发 ownKeys() trap (返 []) → 丢掉所有动态 lookup 能力。
    // 现实上每个 type 只 register 一次 + 给完整 methods,无 merge 需求。
    methods: partial.methods !== undefined ? partial.methods : existing.methods,
    onClose: partial.onClose ?? existing.onClose,
    renderXml: partial.renderXml ?? existing.renderXml,
    compressView: partial.compressView ?? existing.compressView,
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

/**
 * 「renderXml 由 base 原型链提供」的声明集（OOC-4 L4.1 / plan D4）。
 *
 * 某些 window type 的 renderXml 已从 registry 移走、改由 base prototype 链解析
 * （src/executable/windows/_shared/behavior.ts:resolveRenderXml），此处声明它们，
 * 让同步的 assertAllRenderHooksRegistered 不把「registry 无 renderXml」误判为缺失。
 *
 * base proto 是否**真**提供 renderXml 由 behavior 行为等价测试 + 运行期 stat-before-import
 * 兜底，不进 boot 同步路径（async load 会把 fail-loud 退化为 unhandled rejection）。
 */
const CHAIN_PROVIDED_RENDER = new Set<WindowType>();

/** 声明某 type 的 renderXml 由 base 原型链提供（registry 已移走该 hook）。 */
export function markRenderXmlViaPrototype(type: WindowType): void {
  CHAIN_PROVIDED_RENDER.add(type);
}

/**
 * Boot-time 校验：所有已注册的 window type 必须配齐 renderXml hook
 * （或经 markRenderXmlViaPrototype 声明由 base 原型链提供）。
 *
 * 由 windows/index.ts 在所有 side-effect import 之后调用一次，把"缺 renderXml"的失误
 * 从 LLM context（空白 XML 难以察觉）提前到启动期，fail-loud（根因 #4）。
 *
 * **保持同步**（plan D4）：它是 windows/index.ts 顶层同步 boot 副作用，async 化会让
 * fail-loud 退化为 unhandled rejection。chain-provided 判据用同步的 CHAIN_PROVIDED_RENDER 集。
 */
export function assertAllRenderHooksRegistered(): void {
  const missing: WindowType[] = [];
  for (const [type, def] of REGISTRY) {
    if (!def.renderXml && !CHAIN_PROVIDED_RENDER.has(type)) missing.push(type);
  }
  if (missing.length > 0) {
    throw new Error(
      `WindowRegistry: 以下 window type 缺少 renderXml hook（render.ts 调度器要求每个 type 实现接口契约）: ${missing.join(
        ", ",
      )}`,
    );
  }
}
