/**
 * ObjectRegistry — per-world Object 类型注册表。
 *
 * 从 executable/windows/_shared/registry.ts 抽出。
 * cleanup：
 *   - 已删除 string / ObjectTypeDefinition / ObjectMethod 类型引用
 *   - 已删除 deprecated 方法：registerObjectType / getObjectDefinition /
 *     listRegisteredObjectTypes / assertAllObjectDefinitionsRegistered
 *   - 内部统一使用 string / ObjectDefinition / ObjectMethod
 *   - ObjectDefinition 内部字段统一使用 methods / parentClass（旧 commands 字段已弃用）
 */
import type {
  CompressViewHook,
  MethodVisibilityContext,
  ObjectDefinition,
  OnCloseContext,
  OnCloseHook,
  ReadableFn,
  RenderContext,
} from "../_shared/types/registry.js";
import { filterMethodsByVisibility } from "../_shared/types/registry.js";
import type { ObjectMethod } from "../_shared/types/method.js";
import type { WindowMethod } from "../_shared/types/window-method.js";
import type { ContextWindow } from "../_shared/types/context-window.js";

export type {
  ObjectDefinition,
  ObjectMethod,
  ContextWindow,
  OnCloseContext,
  OnCloseHook,
  RenderContext,
  ReadableFn,
  CompressViewHook,
  MethodVisibilityContext,
};
export { filterMethodsByVisibility };

/**
 * exec 名字全局唯一：同一 type 上同名 method 不能既是 object method 又是 window method。
 * dispatch 入口统一（exec by name），重名会导致优先级歧义。注册期 fail-loud。
 */
function assertNoMethodNameCollision(
  type: string,
  methods: Record<string, unknown> | undefined,
  windowMethods: Record<string, unknown> | undefined,
): void {
  if (!methods || !windowMethods) return;
  for (const name of Object.keys(windowMethods)) {
    if (name in methods) {
      throw new Error(
        `Method name "${name}" registered as both object method and window method on "${type}"`,
      );
    }
  }
}

function resolveEffectiveParentClass(
  input: { parentClass?: string | null },
  fallback: ObjectDefinition | undefined,
): string | null | undefined {
  if (input.parentClass !== undefined) return input.parentClass;
  return fallback?.parentClass;
}

/**
 * Base anchors seeded into every new ObjectRegistry. Map key 即 type。
 *
 * **这里只留真正的基类**——不由某个自包含声明站点（builtins 包 / core window 站点）拥有，
 * 而是被全 registry 当作 parentClass 解析锚点 / method 调用临时载体的三个类：
 * - `root`：默认 parentClass 终点（resolveParentClassChain 把 `parentClass===undefined` 解析为 root）。
 * - `method_exec`：method 调用过程的临时载体（Object 内置特性）。
 * - `_builtin/agent`：OOC Agent 基类（承载 agency）。
 *
 * 三者均为 **minimal anchor**：只保证「type 存在、可做继承链终点」。methods / readable /
 * renderableVisible / builtinReadable 等维度由各自的拥有站点经 `registerWindowClass`（或
 * registerExecutable/registerReadable）在 side-effect import 时合入——与所有窗类型一视同仁。
 *
 * **窗类型不再在此硬编码**（旧表曾含 todo / talk / pr / reflect_request / program / file /
 * knowledge / search / skill_index / feishu_chat / feishu_doc / plan / filesystem / terminal /
 * world / knowledge_base / example）：
 * 每个窗类型由其拥有的 builtins 包 / core 站点经 `registerWindowClass` 一处自声明
 * （seed-if-absent + methods + readable + 可见性 flag + parentClass）。`createObjectRegistry()`
 * / `__resetForTests()` 经 `seedFrom(builtinRegistry)` 拿到这些 side-effect 注册的窗类型。
 */
const BASE_TYPE_DEFINITIONS: Array<[string, ObjectDefinition]> = [
  ["root", { methods: {}, parentClass: null }],
  ["method_exec", { methods: {}, parentClass: null }],
  ["_builtin/agent", { methods: {} }],
];

export class ObjectRegistry {
  private readonly store = new Map<string, ObjectDefinition>();

  constructor() {
    for (const [key, def] of BASE_TYPE_DEFINITIONS) {
      this.store.set(key as string, def);
    }
  }

  /**
   * 注册 **executable 维度**：object methods（含 constructor）+ 类元信息
   * （`parentClass` 继承声明 / `isBuiltinFeature` 标记）。
   *
   * 与 {@link registerReadable} 按维度分工——本方法**只**接受 executable 字段，
   * readable 维度（readable / windowMethods / compressView / onClose /
   * consumedMessageIds）走 registerReadable。类型层即拒绝越界字段，
   * 避免两个维度的注册再挤进同一次调用（符号/职责膨胀）。
   *
   * 只更新**已存在的 type**（基类锚点 / 已被 registerWindowClass seed 的窗类型）；
   * 要一处自声明一个新窗类型（含 seed-if-absent + 两维度 + flag）走 {@link registerWindowClass}。
   */
  registerExecutable(
    type: string,
    patch: Pick<Partial<ObjectDefinition>, "methods" | "parentClass" | "isBuiltinFeature">,
  ): void {
    this.mergeExistingDefinition(type, patch, "registerExecutable");
  }

  /**
   * 注册 **readable 维度**：`readable`（展示构造 hook）、
   * `windowMethods`（控制展示的 window method 表）、`compressView`（压缩态渲染）、
   * `onClose`（关闭副作用）、`consumedMessageIds`（transcript 去重 hook）。
   *
   * 与 {@link registerExecutable} 配对：同一 type 的两个维度分别注册、互不覆盖
   * （未传字段保留 existing）。标准对象定义里 readable 维度由 `readable.ts` 自注册。
   */
  registerReadable(
    type: string,
    patch: Pick<
      Partial<ObjectDefinition>,
      "readable" | "windowMethods" | "compressView" | "onClose" | "consumedMessageIds"
    >,
  ): void {
    this.mergeExistingDefinition(type, patch, "registerReadable");
  }

  /**
   * 一次声明完成一个 window class 的全部接线——seed-if-absent + executable 维度
   * （methods / parentClass / isBuiltinFeature）+ readable 维度（readable / windowMethods /
   * compressView / onClose / consumedMessageIds）+ 可见性 flag（renderableVisible /
   * builtinReadable）。把过去散落在 BASE_TYPE_DEFINITIONS seed、registerExecutable、
   * registerReadable、两个硬编码 Set 上的接线收敛到一处声明。
   *
   * **各 builtins 包 / core window 站点的唯一注册入口**：一个包一处 `registerWindowClass({...})`，
   * 在 side-effect import 时把自己 seed 进 builtinRegistry（窗类型不再硬编码在 BASE_TYPE_DEFINITIONS）。
   *
   * 与 {@link registerExecutable} / {@link registerReadable} 的差异：那两个要求 type 已存在
   * 且按维度分注册；本方法对**未 seed 的 type 先建空定义**再合入，故可一次性声明新 window class。
   * 未传字段保留 existing（与 mergeExistingDefinition 同语义），可重复调用增量补全。
   */
  registerWindowClass(
    decl: { type: string } & Pick<
      Partial<ObjectDefinition>,
      | "methods"
      | "parentClass"
      | "isBuiltinFeature"
      | "readable"
      | "windowMethods"
      | "compressView"
      | "onClose"
      | "consumedMessageIds"
      | "renderableVisible"
      | "builtinReadable"
    >,
  ): void {
    const { type, ...patch } = decl;
    if (!this.store.has(type)) {
      // seed-if-absent：建最小空定义（methods 必填），随后 merge 合入声明的字段。
      this.store.set(type, { methods: {} });
    }
    this.mergeExistingDefinition(type, patch, "registerWindowClass");
  }

  /**
   * 维度注册的共用 merge：把 partial 合入已存在的 ObjectDefinition（未传字段保留 existing），
   * 并校验 object method / window method 同名冲突。executable 与 readable 两个维度入口都走这里，
   * 故 method↔windowMethod 同名无论先注册哪个维度都能 fail-loud。
   */
  private mergeExistingDefinition(
    type: string,
    partial: Partial<Omit<ObjectDefinition, "type">>,
    caller: string,
  ): void {
    const existing = this.store.get(type);
    if (!existing) throw new Error(`${caller}: unknown object type "${type}"`);
    const nextMethods = partial.methods !== undefined ? partial.methods : existing.methods;
    const nextWindowMethods =
      partial.windowMethods !== undefined ? partial.windowMethods : existing.windowMethods;
    assertNoMethodNameCollision(type, nextMethods, nextWindowMethods);
    const nextParentClass = resolveEffectiveParentClass(partial, existing);
    this.store.set(type, {
      ...existing,
      methods: nextMethods,
      windowMethods: nextWindowMethods,
      onClose: partial.onClose ?? existing.onClose,
      compressView: partial.compressView ?? existing.compressView,
      readable: partial.readable ?? existing.readable,
      consumedMessageIds: partial.consumedMessageIds ?? existing.consumedMessageIds,
      isBuiltinFeature: partial.isBuiltinFeature ?? existing.isBuiltinFeature,
      renderableVisible: partial.renderableVisible ?? existing.renderableVisible,
      builtinReadable: partial.builtinReadable ?? existing.builtinReadable,
      parentClass: nextParentClass,
    });
  }

  registerNewObjectType(
    type: string,
    definition: Partial<ObjectDefinition> & { methods?: Record<string, any> },
  ): void {
    const entries = definition.methods ?? {};
    assertNoMethodNameCollision(type, entries, definition.windowMethods);
    const effectiveParentClass = resolveEffectiveParentClass(definition, undefined);
    this.store.set(type, {
      onClose: undefined,
      compressView: undefined,
      readable: undefined,
      ...definition,
      methods: entries,
      parentClass: effectiveParentClass,
    });
  }

  getObjectDefinition(type: string): ObjectDefinition {
    const entry = this.store.get(type);
    if (!entry) throw new Error(`getObjectDefinition: object type "${type}" not registered`);
    return entry;
  }

  has(type: string): boolean {
    return this.store.has(type as string);
  }

  isBuiltinFeatureType(type: string): boolean {
    const entry = this.store.get(type);
    if (!entry) return false;
    return entry.isBuiltinFeature === true;
  }

  resolveParentClassChain(startType: string): string[] {
    const chain: string[] = [];
    const seen = new Set<string>([startType]);
    const MAX_DEPTH = 64;
    let cur: string | undefined = startType;
    while (cur && chain.length < MAX_DEPTH) {
      const def = this.store.get(cur as string);
      if (!def) break;
      const next = def.parentClass === undefined ? "root" : def.parentClass ?? undefined;
      if (!next) break;
      if (seen.has(next)) break;
      seen.add(next);
      chain.push(next);
      cur = next;
    }
    return chain;
  }

  lookupMethod(self: { class: string }, methodName: string): ObjectMethod | undefined {
    return this.resolveMethod(self.class, methodName);
  }

  lookupMethodEntry(
    self: { class: string },
    methodName: string,
  ): { entry: ObjectMethod; declaringType: string } | undefined {
    const selfDef = this.store.get(self.class);
    if (selfDef) {
      const selfEntry = selfDef.methods?.[methodName];
      if (selfEntry) return { entry: selfEntry, declaringType: self.class };
    }
    for (const parentType of this.resolveParentClassChain(self.class)) {
      const def = this.store.get(parentType as string);
      if (!def) continue;
      const entry = def.methods?.[methodName];
      if (entry) return { entry, declaringType: parentType as string };
    }
    return undefined;
  }

  resolveMethod(classId: string, methodName: string): ObjectMethod | undefined {
    const selfDef = this.store.get(classId as string);
    if (selfDef) {
      const selfEntry = selfDef.methods?.[methodName];
      if (selfEntry) return selfEntry;
    }
    for (const parentType of this.resolveParentClassChain(classId as string)) {
      const def = this.store.get(parentType as string);
      if (!def) continue;
      const entry = def.methods?.[methodName];
      if (entry) return entry;
    }
    return undefined;
  }

  /** 沿 parentClass 继承链查 window method（控制展示）。镜像 resolveMethod。 */
  lookupWindowMethod(self: { class: string }, name: string): WindowMethod | undefined {
    return this.resolveWindowMethod(self.class, name);
  }

  private resolveWindowMethod(type: string, name: string): WindowMethod | undefined {
    const selfDef = this.store.get(type as string);
    const own = selfDef?.windowMethods?.[name];
    if (own) return own;
    for (const ancestor of this.resolveParentClassChain(type as string)) {
      const inherited = this.store.get(ancestor as string)?.windowMethods?.[name];
      if (inherited) return inherited;
    }
    return undefined;
  }

  lookupConstructor(type: string): ObjectMethod | undefined {
    const def = this.store.get(type);
    if (!def) return undefined;
    const table = def.methods;
    if (!table) return undefined;
    for (const entry of Object.values(table)) {
      if (entry.kind === "constructor") return entry;
    }
    return undefined;
  }

  listRegisteredObjectTypes(): string[] {
    return Array.from(this.store.keys()).sort();
  }

  assertAllObjectDefinitionsRegistered(): void {
    const missing: string[] = [];
    for (const [type, def] of this.store) {
      // _builtin/<id> 是继承类（agency / 成员声明等的载体），不作 window 渲染——不要求 readable hook。
      if (type.startsWith("_builtin/")) continue;
      if (!def.readable) missing.push(type);
    }
    if (missing.length > 0) {
      throw new Error(
        `ObjectRegistry: 以下 object type 缺少 readable hook: ${missing.join(", ")}`,
      );
    }
  }

  /** 查 entry 的 renderableVisible flag（取代旧 module-level RENDERABLE_VISIBLE_TYPES Set）。 */
  private isRenderableVisible(type: string): boolean {
    return this.store.get(type)?.renderableVisible === true;
  }

  resolveEffectiveVisibleType(type: string): string | undefined {
    if (this.isRenderableVisible(type)) return type;
    for (const ancestor of this.resolveParentClassChain(type)) {
      if (this.isRenderableVisible(ancestor)) return ancestor;
    }
    return undefined;
  }

  /**
   * 该 window class 的 readable 是否走 builtin registry hook 短路（取代 xml.ts 旧
   * module-level BUILTIN_TYPES Set）。逐成员等价：renderableVisible 真子集，
   * 不含 pr / reflect_request。
   */
  isBuiltinReadableType(type: string): boolean {
    return this.store.get(type)?.builtinReadable === true;
  }

  /** Snapshot all entries (useful for tests or cloning). */
  snapshot(): Array<[string, ObjectDefinition]> {
    return Array.from(this.store.entries()).map(([k, v]) => [k, { ...v }]);
  }

  /**
   * Reset to base anchors + side-effect-registered builtin window classes (tests only).
   *
   * 先清空 + 重 seed 三个基类锚点，再 `seedFrom(builtinRegistry)` 把各 builtins 包 / core 站点
   * 经 side-effect import 注册的窗类型（file/talk/search/…）拷回——与 {@link createObjectRegistry}
   * 同语义。`builtinRegistry` 自身 reset 时不 seedFrom 自己（避免自合并）。
   */
  __resetForTests(): void {
    this.store.clear();
    for (const [key, def] of BASE_TYPE_DEFINITIONS) {
      this.store.set(key as string, def);
    }
    if (this !== builtinRegistry) this.seedFrom(builtinRegistry);
  }

  /** Copy all entries from another registry, merging methods/hooks. */
  seedFrom(other: ObjectRegistry): void {
    for (const [type, def] of other.snapshot()) {
      const existing = this.store.get(type);
      if (existing) {
        // Merge: other's def takes priority for non-undefined fields
        this.store.set(type, {
          ...existing,
          methods: { ...existing.methods, ...def.methods },
          windowMethods:
            existing.windowMethods || def.windowMethods
              ? { ...existing.windowMethods, ...def.windowMethods }
              : undefined,
          onClose: def.onClose ?? existing.onClose,
          compressView: def.compressView ?? existing.compressView,
          readable: def.readable ?? existing.readable,
          consumedMessageIds: def.consumedMessageIds ?? existing.consumedMessageIds,
          isBuiltinFeature: def.isBuiltinFeature ?? existing.isBuiltinFeature,
          renderableVisible: def.renderableVisible ?? existing.renderableVisible,
          builtinReadable: def.builtinReadable ?? existing.builtinReadable,
          parentClass: def.parentClass !== undefined ? def.parentClass : existing.parentClass,
        });
      } else {
        this.store.set(type, def);
      }
    }
  }
}


/**
 * Module-level singleton holding builtin object type definitions
 * （root / method_exec / _builtin/agent 基类锚点 + 各窗类型 file / plan / program / todo / search /
 * knowledge / skill_index / talk / pr / reflect_request / feishu_chat / feishu_doc / filesystem /
 * terminal / world / knowledge_base / …）.
 *
 * Builtin modules / core window 站点 populate this via side-effect imports at module load time：
 * 每个窗类型一处 `builtinRegistry.registerWindowClass({ type, methods, parentClass, readable, ... })`
 * （seed-if-absent + 两维度 + 可见性 flag）。窗类型不再在 BASE_TYPE_DEFINITIONS 硬编码——只剩基类锚点。
 *
 * think / exec / render 默认就用这个 module-level registry（buildContext /
 * dispatchToolCall 不显式传 registry 时回退到它）。per-world / 测试经 createObjectRegistry()
 * `seedFrom` 本 registry 拿到等价窗类型集合。
 *
 * Stone-backed user-defined types are NOT registered here at load time — they are
 * registered on demand by the render-time lazy ensure in
 * `thinkable/context/object-windows.ts`（首次进入某 thread context 时从磁盘加载）.
 */
export const builtinRegistry = new ObjectRegistry();

/**
 * 建一份 per-world / per-test registry：先 seed 三个基类锚点（constructor），
 * 再 `seedFrom(builtinRegistry)` 拷入各 builtins 包 / core 站点经 side-effect import 注册的
 * **窗类型**（file/talk/search/plan/…）。
 *
 * 这是窗类型从 BASE_TYPE_DEFINITIONS 移出后的安全网：think/exec/render 默认用全局 builtinRegistry
 * （已含全部窗类型），而 per-world / 测试用 createObjectRegistry() 经此拿到等价集合。
 * 任何真实入口（buildServer / windows barrel）都在 createObjectRegistry 之前 load 完 builtins，
 * 故 seedFrom 时 builtinRegistry 已就绪。
 */
export function createObjectRegistry(): ObjectRegistry {
  const reg = new ObjectRegistry();
  reg.seedFrom(builtinRegistry);
  return reg;
}
