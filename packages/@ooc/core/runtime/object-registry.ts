/**
 * ObjectRegistry — per-world Object 类型注册表。
 *
 * M1 (2026-06-02): 从 executable/windows/_shared/registry.ts 抽出。
 * 2026-06-03 ooc-6 cleanup Phase A：
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

const RENDERABLE_VISIBLE_TYPES = new Set([
  "root", "method_exec", "do", "todo", "talk", "pr", "program",
  "file", "knowledge", "search", "skill_index",
  "feishu_chat", "feishu_doc", "plan",
]);

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

/** Base types seeded into every new ObjectRegistry. Map key 即 type。 */
const BASE_TYPE_DEFINITIONS: Array<[string, ObjectDefinition]> = [
  ["root", { methods: {}, parentClass: null }],
  ["method_exec", { methods: {}, parentClass: null }],
  ["do", { methods: {} }],
  ["todo", { methods: {} }],
  ["talk", { methods: {} }],
  ["pr", { methods: {} }],
  ["program", { methods: {} }],
  ["file", { methods: {} }],
  ["knowledge", { methods: {} }],
  ["search", { methods: {} }],
  ["skill_index", { methods: {} }],
  ["feishu_chat", { methods: {} }],
  ["feishu_doc", { methods: {} }],
  ["plan", { methods: {} }],
  // example —— 标准对象定义样板（executable/index.ts + readable.ts 两维度分注册示范）。
  ["example", { methods: {} }],
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
   * 只更新**已 seed 的 type**（BASE_TYPE_DEFINITIONS）；新 type 走 registerNewObjectType。
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
      if (!def.readable) missing.push(type);
    }
    if (missing.length > 0) {
      throw new Error(
        `ObjectRegistry: 以下 object type 缺少 readable hook: ${missing.join(", ")}`,
      );
    }
  }

  resolveEffectiveVisibleType(type: string): string | undefined {
    if (RENDERABLE_VISIBLE_TYPES.has(type)) return type;
    for (const ancestor of this.resolveParentClassChain(type)) {
      if (RENDERABLE_VISIBLE_TYPES.has(ancestor)) return ancestor;
    }
    return undefined;
  }

  /** Snapshot all entries (useful for tests or cloning). */
  snapshot(): Array<[string, ObjectDefinition]> {
    return Array.from(this.store.entries()).map(([k, v]) => [k, { ...v }]);
  }

  /** Empty the registry (tests only). */
  __resetForTests(): void {
    this.store.clear();
    for (const [key, def] of BASE_TYPE_DEFINITIONS) {
      this.store.set(key as string, def);
    }
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
          parentClass: def.parentClass !== undefined ? def.parentClass : existing.parentClass,
        });
      } else {
        this.store.set(type, def);
      }
    }
  }
}


/**
 * Module-level singleton holding builtin object type definitions (root, file,
 * plan, program, todo, search, knowledge, skill_index, do, talk, method_exec,
 * feishu_chat, feishu_doc).
 *
 * Builtin modules populate this via side-effect imports at module load time:
 * executable/index.ts 调 `builtinRegistry.registerExecutable("file", { methods })`，
 * readable.ts 调 `builtinRegistry.registerReadable("file", { readable, windowMethods, ... })`。
 *
 * Each per-world `WorldRuntime.objects` seeds itself from this registry at
 * construction time, so builtins are available in every world without being
 * re-registered.
 *
 * Stone-backed user-defined types are NOT registered here — they are registered
 * per-world by `ObjectTypeRegistrar`.
 */
export const builtinRegistry = new ObjectRegistry();

export function createObjectRegistry(): ObjectRegistry {
  return new ObjectRegistry();
}
