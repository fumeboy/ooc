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

import type { CommandTableEntry, ObjectMethod } from "./command-types.js";
import type { ThreadContext } from "../../../thinkable/context.js";
import type { XmlNode } from "../../../thinkable/context/xml.js";
import type { ContextWindow, WindowType, ObjectType, ContextObject } from "./types.js";

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
 * Readable 函数类型（2026-05-28 ooc-6 新增）。
 * Object 可以通过 readable.ts 导出该类型的函数，控制自己在 Context 中如何以 XML 形式展示给 LLM。
 * 优先级高于 readable.md 和默认渲染。
 */
export type ReadableFn = (ctx: RenderContext) => XmlNode[] | Promise<XmlNode[]>;

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
/** @deprecated Use ObjectDefinition instead (2026-05-28 ooc-6 Object Unification). WindowTypeDefinition is being renamed to ObjectDefinition. */
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
  /**
   * 动态上下文渲染函数（2026-05-28 ooc-6 Object Unification）。
   * 与 ObjectDefinition.readable 同形：优先级高于 readable.md 与默认 renderXml。
   * 在 WindowTypeDefinition 上保留入口，方便 builtin type 在 registerObjectType 时直接注入。
   */
  readable?: ReadableFn;
  /**
   * P6.§6 (2026-06-02): 该 type 是「Object 内置特性」（true）还是「独立 flow object」（false）。
   * 见 ObjectDefinition.isBuiltinFeature 的完整 JSDoc。WindowTypeDefinition 上保留同名入口
   * 是为了让 talk / do 通过 registerWindowType 注入 partial 时也能直接声明该字段。
   */
  isBuiltinFeature?: boolean;
  /**
   * P6.§7 (2026-06-02): 父类 id；method 解析在 self.type 上 miss 后沿父类链向上回退。
   * 见 ObjectDefinition.parentClass 的完整 JSDoc——同语义、同三态约定。
   */
  parentClass?: string | null;
}

/**
 * Object Definition 类型（原 WindowTypeDefinition 扩展，2026-05-28 ooc-6 Object Unification）。
 * 合并了 WindowType 注册与 Object Method 定义，增加 prototype 和 readable 字段。
 *
 * methods（推荐）/ commands（@deprecated 别名）：
 *   2026-05-28 ooc-6 之后 method 是 canonical 名；commands 是过渡期 alias。
 *   读取时优先 methods，回落 commands；写入时双写两个字段保持一致。
 */
export interface ObjectDefinition extends Omit<WindowTypeDefinition, "commands"> {
  type: ObjectType;
  /** 该 object 注册的 method 集合（canonical 名）。 */
  methods: Record<string, ObjectMethod>;
  /**
   * @deprecated Use `methods` instead. Kept as alias during ooc-6 Object Unification transition;
   * registry 内部双写以保持一致。
   */
  commands: Record<string, ObjectMethod>;
  /**
   * @deprecated Use `parentClass` instead (2026-06-02 P6.§7 inheritance unification).
   * `prototype` was the stone self.md frontmatter field for specifying a parent;
   * it is now normalized to `parentClass` at registration time. Kept as alias
   * during transition; internally everything reads/writes `parentClass`.
   */
  prototype?: string;
  /**
   * 动态上下文渲染函数；优先级高于 readable.md。
   * 与 readable.ts 导出的函数类型一致。
   */
  readable?: ReadableFn;
  /**
   * P6.§6 (2026-06-02): 该 type 是「Object 内置特性」（true）还是「独立 flow object」（false）。
   *
   * 内置特性 (true) — 例：talk / do / todo / method_exec：
   *   - 不写 `flows/<sid>/<id>/` 目录、不写 `.flow.json`、不写 `state.json`
   *   - 实例的状态 inline 进所属 thread 的 `<parentOid>/threads/<tid>/context.json`
   *   - 是任何 Object 都自带的能力（任何 Object 都能 talk/do；form 是某个 method 调用的临时载体）
   *
   * 独立 flow object (false / undefined) — 例：plan / program / file / knowledge / search /
   *   skill_index / user / supervisor / 各 stone runtime 实例：
   *   - 写 `flows/<sid>/<oid>/.flow.json` + `flows/<sid>/<oid>/state.json`（仅自身字段，不含 contextWindows）
   *   - 在所属 thread 的 `context.json` 里以 `{ id, type, _ref: true, refObjectId }` 形态出现
   *
   * 关键不变量：state（object 维度，跨线程共享）和 context（thread 维度，每个 thread 一份）
   * 必须分文件——`state.json` 不放 contextWindows，contextWindows 永远在 `<oid>/threads/<tid>/context.json`。
   *
   * 默认 false（独立 flow object）。
   */
  isBuiltinFeature?: boolean;
  /**
   * P6.§7 (2026-06-02): 父类 id —— 统一的继承链载体（methods / readable / knowledge / visible 共用）。
   *
   * 三态语义（undefined ≠ null）：
   *   - **undefined**（缺省）→ 隐式继承 `"root"`：ObjectDefinition 默认拿到 root 上注册的所有
   *     通用方法（talk / do / todo / plan / program / open_file / open_knowledge / write_file /
   *     glob / grep / metaprog / open_feishu_chat / open_feishu_doc）。绝大多数 type 走这条。
   *   - **`null`**（显式不继承）→ 完全独立，继承链不沿父链回退。仅 `root` 自身与
   *     `method_exec`（form lifecycle 内部 type，不应暴露 user-facing 方法）使用。
   *   - **string**（具名父类）→ 必须是 object registry 中已注册的 ObjectType id；解析在自身
   *     methods/readable/knowledge/visible 上 miss 后跳到 `getObjectDefinition(parentClass)`
   *     继续查，递归直到 `null` 或链长达到防御阈值。
   *
   * 与 `prototype`（self.md frontmatter 的字段）的关系：`prototype` 在 P6.§7 已降级为
   * `parentClass` 的配置别名。stone 动态注册时，若 `executable/index.ts` 未显式声明
   * `parentClass`，则读取 self.md frontmatter 的 `prototype` 字段回填。
   */
  parentClass?: string | null;
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
  methods: {},
  // P6.§7 (2026-06-02): root 是继承链的终点 —— 显式 null 截断默认 "root" 回退，避免 self → root → root 死循环。
  parentClass: null,
} as ObjectDefinition);

REGISTRY.set("command_exec", {
  type: "command_exec",
  commands: {},
  methods: {},
  // P6.§7 (2026-06-02): method_exec / command_exec 是 form lifecycle 内部 type，方法表只能含 refine/submit；
  //                     不应继承 root 上 user-facing 的 talk/do/todo/...，故显式 null。
  parentClass: null,
} as ObjectDefinition);

// P6.§9 (2026-06-02): "method_exec" 是新的 canonical 名（OOP 命名归一化）；"command_exec" 保留为 legacy alias 一个 release。
//                     两者注册同一份 methods/readable（见 core/executable/windows/method_exec/index.ts），
//                     使得：(a) 旧持久化 type="command_exec" 的 form 仍可 hydrate 解析方法；
//                          (b) 新代码可以直接用 type="method_exec"。
REGISTRY.set("method_exec", {
  type: "method_exec",
  commands: {},
  methods: {},
  parentClass: null,
} as ObjectDefinition);

REGISTRY.set("do", {
  type: "do",
  commands: {},
  methods: {},
} as ObjectDefinition);

REGISTRY.set("todo", {
  type: "todo",
  commands: {},
  methods: {},
} as ObjectDefinition);

REGISTRY.set("talk", {
  type: "talk",
  commands: {},
  methods: {},
} as ObjectDefinition);

REGISTRY.set("program", {
  type: "program",
  commands: {},
  methods: {},
} as ObjectDefinition);

REGISTRY.set("file", {
  type: "file",
  commands: {},
  methods: {},
} as ObjectDefinition);

REGISTRY.set("knowledge", {
  type: "knowledge",
  commands: {},
  methods: {},
} as ObjectDefinition);

REGISTRY.set("search", {
  type: "search",
  commands: {},
  methods: {},
} as ObjectDefinition);

/** @deprecated ooc-6: "relation" type replaced by peer Object auto-injection (derivePeerObjectWindows). Kept for backward compat with persisted thread data; Phase 9 cleanup will remove. */
REGISTRY.set("relation", {
  type: "relation",
  commands: {},
  methods: {},
} as ObjectDefinition);

REGISTRY.set("skill_index", {
  type: "skill_index",
  commands: {},
  methods: {},
} as ObjectDefinition);

REGISTRY.set("feishu_chat", {
  type: "feishu_chat",
  commands: {},
  methods: {},
} as ObjectDefinition);

REGISTRY.set("feishu_doc", {
  type: "feishu_doc",
  commands: {},
  methods: {},
} as ObjectDefinition);

REGISTRY.set("plan", {
  type: "plan",
  commands: {},
  methods: {},
} as ObjectDefinition);

/**
 * 替换或合并某 type 的契约，用于 windows/do.ts、windows/todo.ts 在模块加载时注入实现。
 *
 * 合并策略：commands 浅合并（key 冲突时新值覆盖）；onClose / renderXml 直接覆盖。
 */
/** @deprecated Use registerObjectType instead (2026-05-28 ooc-6 Object Unification). registerWindowType is being renamed to registerObjectType. */
export function registerWindowType(
  type: WindowType,
  partial: Partial<Omit<WindowTypeDefinition, "type">>,
): void {
  const existing = REGISTRY.get(type);
  if (!existing) {
    throw new Error(`registerWindowType: unknown window type "${type}"`);
  }
  // 保持 commands/methods 双写一致：partial.commands → 同时写 methods
  const nextCommands = partial.commands !== undefined ? partial.commands : existing.commands;
  // P6.§7: parentClass 三态 + prototype @deprecated alias 归一化（与 registerObjectType 一致）。
  const nextParentClass = resolveEffectiveParentClass(partial, existing as ObjectDefinition);
  REGISTRY.set(type, {
    ...existing,
    // 直接替换不展开:custom window 用 Proxy 做 dynamic dispatcher,
    // 展开 (...) 会触发 ownKeys() trap (返 []) → 丢掉所有动态 lookup 能力。
    // 现实上每个 type 只 register 一次 + 给完整 commands,无 merge 需求。
    commands: nextCommands,
    methods: nextCommands,
    onClose: partial.onClose ?? existing.onClose,
    renderXml: partial.renderXml ?? existing.renderXml,
    compressView: partial.compressView ?? existing.compressView,
    basicKnowledge: partial.basicKnowledge ?? existing.basicKnowledge,
    isBuiltinFeature: partial.isBuiltinFeature ?? existing.isBuiltinFeature,
    parentClass: nextParentClass,
  } as WindowTypeDefinition);
}

/**
 * 注册或更新 Object 类型的契约（原 registerWindowType 重命名，2026-05-28 ooc-6）。
 * 支持 ObjectDefinition 的 prototype 和 readable 字段。
 *
 * methods（推荐）/ commands（@deprecated 别名）：partial 任一字段都接受，写入时同步双写两个字段。
 */
export function registerObjectType(
  type: ObjectType,
  partial: Partial<Omit<ObjectDefinition, "type">>,
): void {
  const existing = REGISTRY.get(type) as ObjectDefinition | undefined;
  if (!existing) {
    throw new Error(`registerObjectType: unknown object type "${type}"`);
  }
  // 读 partial 时优先 methods，回落 commands；写入时双写两个字段
  const nextEntries =
    partial.methods !== undefined
      ? partial.methods
      : partial.commands !== undefined
        ? partial.commands
        : existing.methods;
  // P6.§7: parentClass 三态判定 + prototype 别名归一化。
  // 优先级：partial.parentClass（显式声明） > partial.prototype（@deprecated alias） > existing.parentClass。
  const nextParentClass = resolveEffectiveParentClass(partial, existing);
  REGISTRY.set(type, {
    ...existing,
    commands: nextEntries,
    methods: nextEntries,
    onClose: partial.onClose ?? existing.onClose,
    renderXml: partial.renderXml ?? existing.renderXml,
    compressView: partial.compressView ?? existing.compressView,
    basicKnowledge: partial.basicKnowledge ?? existing.basicKnowledge,
    // prototype @deprecated: 保留字段以防外部还在读；内部统一用 parentClass。
    prototype: partial.prototype ?? existing.prototype,
    readable: partial.readable ?? existing.readable,
    isBuiltinFeature: partial.isBuiltinFeature ?? existing.isBuiltinFeature,
    parentClass: nextParentClass,
  } as ObjectDefinition);
}

/**
 * Dynamically register a completely new object type at runtime (2026-06-01 ooc-6).
 * Used for custom objects discovered at runtime (peer objects, runtime-created objects).
 * Unlike registerObjectType which updates existing entries, this adds a new entry.
 *
 * methods / commands 同步：定义中任一字段都接受，写入时双写两个字段。
 */
export function registerNewObjectType(
  type: ObjectType,
  definition: Partial<ObjectDefinition> & { commands?: Record<string, any>; methods?: Record<string, any> },
): void {
  const entries = definition.methods ?? definition.commands ?? {};
  // P6.§7: parentClass 三态 + prototype 别名归一化。
  // 优先级：definition.parentClass > definition.prototype（@deprecated alias）> undefined（隐式继承 root）。
  const effectiveParentClass = resolveEffectiveParentClass(definition, undefined);
  REGISTRY.set(type, {
    type,
    onClose: undefined,
    renderXml: undefined,
    compressView: undefined,
    basicKnowledge: undefined,
    prototype: undefined,
    readable: undefined,
    ...definition,
    commands: entries,
    methods: entries,
    parentClass: effectiveParentClass,
  } as ObjectDefinition);
}

/** 取得指定 type 的契约；未注册时抛错（避免静默吞掉新 type）。 */
/** @deprecated Use getObjectDefinition instead (2026-05-28 ooc-6 Object Unification). getWindowTypeDefinition is being renamed to getObjectDefinition. */
export function getWindowTypeDefinition(type: WindowType): WindowTypeDefinition {
  const entry = REGISTRY.get(type);
  if (!entry) {
    throw new Error(`getWindowTypeDefinition: window type "${type}" not registered`);
  }
  return entry;
}

/** 取得指定 Object 类型的定义（原 getWindowTypeDefinition 重命名，2026-05-28 ooc-6）。 */
export function getObjectDefinition(type: ObjectType): ObjectDefinition {
  const entry = REGISTRY.get(type) as ObjectDefinition | undefined;
  if (!entry) {
    throw new Error(`getObjectDefinition: object type "${type}" not registered`);
  }
  return entry;
}

/**
 * P6.§6 (2026-06-02): 判定一个 Object type 是否为「内置特性」。
 *
 * - true → talk / do / todo / method_exec 等：不写独立 dir + state.json，
 *   状态 inline 进所属 thread 的 `context.json`。
 * - false → 独立 flow object（plan / program / file / ... / 各 stone runtime 实例）：
 *   写 `<oid>/.flow.json` + `<oid>/state.json`，并在 thread `context.json` 里以 ref 出现。
 *
 * 未注册的 type 保守返回 false（按独立 flow object 处理；这样比错误地丢失状态更安全）。
 * 已注册但未声明 isBuiltinFeature 的 type 也按 false 处理（默认是独立）。
 */
export function isBuiltinFeatureType(type: ObjectType): boolean {
  const entry = REGISTRY.get(type) as ObjectDefinition | undefined;
  if (!entry) return false;
  return entry.isBuiltinFeature === true;
}

/**
 * P6.§7 (2026-06-02): 归一化 parentClass：统一处理 parentClass 三态 + prototype @deprecated alias。
 *
 * 优先级：input.parentClass（显式声明） → input.prototype（@deprecated alias） → fallback。
 * fallback 是已有的定义（registerObjectType）或 undefined（registerNewObjectType，隐式继承 root）。
 *
 * "parentClass" in input 判定必须用 `in` 而非 `??`，因为 `null` 是有意义的显式值（"完全不继承"）。
 * "prototype" in input 也用 `in`，同理。
 */
function resolveEffectiveParentClass(
  input: { parentClass?: string | null; prototype?: string },
  fallback: ObjectDefinition | undefined,
): string | null | undefined {
  if ("parentClass" in input) return input.parentClass;
  if ("prototype" in input && input.prototype !== undefined) return input.prototype;
  return fallback?.parentClass;
}

/**
 * P6.§7 (2026-06-02): 统一的 parentClass 链 walker。
 *
 * 给定起始 type，按"最近祖先 → 更远祖先"顺序返回继承链上的 type id 列表（不含起始 type 自身）。
 * 返回顺序 = 从 closest 到 farthest，方便后续"先找近的、命中即停"使用。
 *
 * 三态语义（与 ObjectDefinition.parentClass 一致）：
 *   - undefined → 默认回退到 "root"（让所有未显式声明的 type 都继承 root）
 *   - null → 链终止（不回退任何父类）
 *   - string → 沿该父类继续查
 *
 * 环检测：seen Set 兜底，避免 A→B→A 死循环；链长上限 64 防御。
 *
 * 起始 type 未注册 → 返回空数组（不抛错，caller 决定是否 fail-loud）。
 */
export function resolveParentClassChain(startType: ObjectType): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([startType]);
  const MAX_DEPTH = 64;
  let cur: string | undefined = startType;
  while (cur && chain.length < MAX_DEPTH) {
    const def = REGISTRY.get(cur as ObjectType) as ObjectDefinition | undefined;
    if (!def) break;
    // 三态语义：undefined → "root"；null → 终止；string → 命名父类
    const next = def.parentClass === undefined ? "root" : def.parentClass ?? undefined;
    if (!next) break;
    if (seen.has(next)) break;
    seen.add(next);
    chain.push(next);
    cur = next;
  }
  return chain;
}

/**
 * 在指定 parent ContextWindow 上查找 method（2026-05-28 ooc-6 Object Unification）。
 *
 * P6.§7 (2026-06-02): 现在沿 class.parentClass 继承链向上回退（resolveMethod）；
 * 在自身 type 上 miss 时跳到 parentClass 继续查，直到命中或链终止（null / 不存在）。
 *
 * 优先读 `def.methods`（canonical 名）；若 methods 中未声明该名，回落到 `def.commands`
 * （@deprecated alias）以兼容尚未迁移的 caller。
 *
 * 等价于旧的 manager 内部 helper `lookupCommandEntry`，但作为 registry 公共 API 暴露，
 * 使新代码（root method delegate / dispatch / synthesizer）可统一通过 lookupMethod 检索。
 */
export function lookupMethod(
  parentWindow: { type: ObjectType },
  methodName: string,
): ObjectMethod | undefined {
  return resolveMethod(parentWindow.type, methodName);
}

/**
 * P6.§3 (2026-06-02): 同 `lookupMethod`，但额外返回 `declaringType`——即该 method 实际在
 * 哪个 Object class 上声明。manager.submit 在 dispatch 阶段用它做严格校验：method 必须
 * 由 parent.type（或其父类链）声明，否则拒绝执行（`[method-error] method "X" not declared on object class "Y"`）。
 *
 * P6.§7 (2026-06-02): 沿 parentClass 链向上回退；declaringType 是命中处的 class id（可能是
 * parent.type 的祖先，不一定 === parent.type）。语义保持「method 注册在错的 type 上」时
 * fail-loud，但允许通过显式继承（parentClass: "root"）拿到 root 的 talk/do/todo/...。
 */
export function lookupMethodEntry(
  parentWindow: { type: ObjectType },
  methodName: string,
): { entry: ObjectMethod; declaringType: ObjectType } | undefined {
  // 先查 self，再沿 parentClass 链向上回退（closest first）。
  const selfDef = REGISTRY.get(parentWindow.type) as ObjectDefinition | undefined;
  if (selfDef) {
    const selfEntry = selfDef.methods?.[methodName] ?? selfDef.commands?.[methodName];
    if (selfEntry) return { entry: selfEntry, declaringType: parentWindow.type };
  }
  for (const parentType of resolveParentClassChain(parentWindow.type)) {
    const def = REGISTRY.get(parentType as ObjectType) as ObjectDefinition | undefined;
    if (!def) continue;
    const entry = def.methods?.[methodName] ?? def.commands?.[methodName];
    if (entry) return { entry, declaringType: parentType as ObjectType };
  }
  return undefined;
}

/**
 * P6.§7 (2026-06-02): 沿 class.parentClass 链向上找 method。
 *
 * 先在 classId 自身查；miss 后沿 resolveParentClassChain（closest → farthest）向上回退，
 * 直到命中或链终止。缺省 / 不存在均返回 undefined。
 */
export function resolveMethod(
  classId: string,
  methodName: string,
): ObjectMethod | undefined {
  const selfDef = REGISTRY.get(classId as ObjectType) as ObjectDefinition | undefined;
  if (selfDef) {
    const selfEntry = selfDef.methods?.[methodName] ?? selfDef.commands?.[methodName];
    if (selfEntry) return selfEntry;
  }
  for (const parentType of resolveParentClassChain(classId as ObjectType)) {
    const def = REGISTRY.get(parentType as ObjectType) as ObjectDefinition | undefined;
    if (!def) continue;
    const entry = def.methods?.[methodName] ?? def.commands?.[methodName];
    if (entry) return entry;
  }
  return undefined;
}

/**
 * P6.§4 (2026-06-02): 在指定 Object type 的定义中查找 `kind: "constructor"` 的 ObjectMethod。
 *
 * 用途：root method（如 `talk` / `do` / `plan` / `program` / `open_file` 等）在 P6 退化为
 * 「调对应 type 的 constructor」的薄分发器。本函数让 root method 不必自己缓存或硬编码
 * constructor 引用——只需 `lookupConstructor("talk")` 就能拿到 talk 类型上注册的构造方法。
 *
 * 解析顺序：
 *   1. 优先扫 `def.methods`（canonical），返回首个 `kind === "constructor"` 的 entry。
 *   2. 回落 `def.commands`（@deprecated alias）以兼容尚未迁移的 caller。
 *
 * 不命中返回 undefined；root method 应据此返回结构化错误（不要 fail-soft 到默认实现）。
 *
 * 与 `lookupMethod`/`lookupMethodEntry` 的区别：后两者按方法**名**索引；本函数按
 * `kind === "constructor"` **标记**索引——一个 type 的 constructor 不必与 type 同名（虽
 * 然按惯例通常是同名，例如 talk type 的 constructor 注册在 methods["talk"]）。
 */
export function lookupConstructor(type: ObjectType): ObjectMethod | undefined {
  const def = REGISTRY.get(type) as ObjectDefinition | undefined;
  if (!def) return undefined;
  const scan = (table: Record<string, ObjectMethod> | undefined) => {
    if (!table) return undefined;
    for (const entry of Object.values(table)) {
      if (entry.kind === "constructor") return entry;
    }
    return undefined;
  };
  return scan(def.methods) ?? scan(def.commands);
}

/** 列出所有已注册 type，按字母序返回。 */
/** @deprecated Use listRegisteredObjectTypes instead (2026-05-28 ooc-6 Object Unification). listRegisteredWindowTypes is being renamed to listRegisteredObjectTypes. */
export function listRegisteredWindowTypes(): WindowType[] {
  return Array.from(REGISTRY.keys()).sort();
}

/** 列出所有已注册的 Object 类型（原 listRegisteredWindowTypes 重命名，2026-05-28 ooc-6）。 */
export function listRegisteredObjectTypes(): ObjectType[] {
  return Array.from(REGISTRY.keys())
    .filter((t): t is ObjectType => t !== "relation")
    .sort();
}

/**
 * Boot-time 校验：所有已注册的 window type 必须配齐 renderXml hook。
 *
 * 由 windows/index.ts 在所有 side-effect import 之后调用一次，把"缺 renderXml"的失误
 * 从 LLM context（空白 XML 难以察觉）提前到启动期，fail-loud（根因 #4）。
 */
/** @deprecated Use assertAllObjectDefinitionsRegistered instead (2026-05-28 ooc-6 Object Unification). */
export function assertAllRenderHooksRegistered(): void {
  const missing: WindowType[] = [];
  for (const [type, def] of REGISTRY) {
    if (!def.renderXml) missing.push(type);
  }
  if (missing.length > 0) {
    throw new Error(
      `WindowRegistry: 以下 window type 缺少 renderXml hook（render.ts 调度器要求每个 type 实现接口契约）: ${missing.join(
        ", ",
      )}`,
    );
  }
}

/**
 * Boot-time 校验：所有已注册的 Object type 必须配齐 renderXml 或 readable hook（2026-05-28 ooc-6）。
 * 有 readable 的 object 可以缺省 renderXml，因为 readable.ts 会控制渲染。
 */
export function assertAllObjectDefinitionsRegistered(): void {
  const missing: ObjectType[] = [];
  for (const [type, def] of REGISTRY) {
    if (type === "relation") continue;
    const objDef = def as ObjectDefinition;
    if (!objDef.renderXml && !objDef.readable) missing.push(type);
  }
  if (missing.length > 0) {
    throw new Error(
      `ObjectRegistry: 以下 object type 缺少 renderXml 或 readable hook: ${missing.join(", ")}`,
    );
  }
}

/**
 * P6.§7 (2026-06-02): 前端 ContextSnapshotViewer 能静态渲染的 type 集合。
 *
 * 与 web/src/domains/files/components/ContextSnapshotViewer.tsx:HANDLED_WINDOW_TYPES 保持一致；
 * 两端是 mirror（前端用这个 set 做 switch，后端用它做继承链回退）。
 */
const RENDERABLE_VISIBLE_TYPES = new Set([
  "root", "command_exec", "do", "todo", "talk", "program",
  "file", "knowledge", "search", "relation", "skill_index",
  "feishu_chat", "feishu_doc", "plan",
]);

/**
 * P6.§7 (2026-06-02): 沿 parentClass 继承链找"首个前端可渲染"的 type。
 *
 * 语义：
 *   - 若 type 本身就在 RENDERABLE_VISIBLE_TYPES 中 → 返回 type 自身
 *   - 否则沿 resolveParentClassChain（closest → farthest）找第一个在集合中的 ancestor
 *   - 整条链都不在集合中 → 返回 undefined（前端按原 type 渲染，通常回退到 JSON）
 *
 * 自定义 stone 对象（type = objectId）可通过 parentClass 声明"我属于哪类 UI"，
 * 例如 `parentClass: "plan"` 让前端按 plan 的 visible 组件渲染。
 */
export function resolveEffectiveVisibleType(type: ObjectType): string | undefined {
  if (RENDERABLE_VISIBLE_TYPES.has(type)) return type;
  for (const ancestor of resolveParentClassChain(type)) {
    if (RENDERABLE_VISIBLE_TYPES.has(ancestor)) return ancestor;
  }
  return undefined;
}

// ─── Method Visibility Filtering (2026-05-28 ooc-6 Object Unification) ───

export type MethodVisibilityContext =
  | { kind: "self" }                          // Object 自己的 context，可见所有 methods
  | { kind: "peer"; viewerObjectId: string }   // 其他 Object 的引用，仅可见 public methods
  | { kind: "ui" };                             // 前端 API 调用，仅可见 for_ui_access methods

/**
 * 根据上下文过滤 methods 的可见性。
 * - self: 返回所有 methods
 * - peer: 仅返回 public: true 的 methods
 * - ui: 仅返回 for_ui_access: true 的 methods
 */
export function filterMethodsByVisibility(
  methods: Record<string, ObjectMethod>,
  ctx: MethodVisibilityContext,
): Record<string, ObjectMethod> {
  const filtered: Record<string, ObjectMethod> = {};

  for (const [name, method] of Object.entries(methods)) {
    switch (ctx.kind) {
      case "self":
        filtered[name] = method;
        break;
      case "peer":
        if (method.public === true) {
          filtered[name] = method;
        }
        break;
      case "ui":
        if (method.for_ui_access === true) {
          filtered[name] = method;
        }
        break;
    }
  }

  return filtered;
}
