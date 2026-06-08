/**
 * ObjectRegistry — per-world Object 类型注册表。
 *
 * M1 (2026-06-02): 从 executable/windows/_shared/registry.ts 抽出。
 * 2026-06-03 ooc-6 cleanup Phase A：
 *   - 已删除 ObjectType / ObjectTypeDefinition / ObjectMethod 类型引用
 *   - 已删除 deprecated 方法：registerObjectType / getObjectDefinition /
 *     listRegisteredObjectTypes / assertAllObjectDefinitionsRegistered
 *   - 内部统一使用 ObjectType / ObjectDefinition / ObjectMethod
 *   - ObjectDefinition 内部字段统一使用 methods / parentClass（不再兼容 commands / prototype）
 */
import type {
  CompressViewHook,
  MethodVisibilityContext,
  ObjectDefinition,
  OnCloseContext,
  OnCloseHook,
  ReadableFn,
  RenderContext,
  RenderHook,
} from "../_shared/types/registry.js";
import { filterMethodsByVisibility } from "../_shared/types/registry.js";
import type { ObjectMethod } from "../_shared/types/method.js";
import type { WindowMethod } from "../_shared/types/window-method.js";
import type { ContextWindow, ObjectType } from "../_shared/types/context-window.js";

export type {
  ObjectDefinition,
  ObjectType,
  ObjectMethod,
  ContextWindow,
  OnCloseContext,
  OnCloseHook,
  RenderContext,
  RenderHook,
  ReadableFn,
  CompressViewHook,
  MethodVisibilityContext,
};
export { filterMethodsByVisibility };

const RENDERABLE_VISIBLE_TYPES = new Set([
  "root", "method_exec", "command_exec", "do", "todo", "talk", "program",
  "file", "knowledge", "search", "relation", "skill_index",
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

/** Base types seeded into every new ObjectRegistry. */
const BASE_TYPE_DEFINITIONS: Array<[string, ObjectDefinition]> = [
  ["root", { type: "root", methods: {}, parentClass: null } as ObjectDefinition],
  ["command_exec", { type: "command_exec", methods: {}, parentClass: null } as ObjectDefinition],
  ["method_exec", { type: "method_exec", methods: {}, parentClass: null } as ObjectDefinition],
  ["do", { type: "do", methods: {} } as ObjectDefinition],
  ["todo", { type: "todo", methods: {} } as ObjectDefinition],
  ["talk", { type: "talk", methods: {} } as ObjectDefinition],
  ["program", { type: "program", methods: {} } as ObjectDefinition],
  ["file", { type: "file", methods: {} } as ObjectDefinition],
  ["knowledge", { type: "knowledge", methods: {} } as ObjectDefinition],
  ["search", { type: "search", methods: {} } as ObjectDefinition],
  ["relation", { type: "relation", methods: {} } as ObjectDefinition],
  ["skill_index", { type: "skill_index", methods: {} } as ObjectDefinition],
  ["feishu_chat", { type: "feishu_chat", methods: {} } as ObjectDefinition],
  ["feishu_doc", { type: "feishu_doc", methods: {} } as ObjectDefinition],
  ["plan", { type: "plan", methods: {} } as ObjectDefinition],
];

export class ObjectRegistry {
  private readonly store = new Map<ObjectType, ObjectDefinition>();

  constructor() {
    for (const [key, def] of BASE_TYPE_DEFINITIONS) {
      this.store.set(key as ObjectType, def);
    }
  }

  registerObjectType(type: ObjectType, partial: Partial<Omit<ObjectDefinition, "type">>): void {
    const existing = this.store.get(type);
    if (!existing) throw new Error(`registerObjectType: unknown object type "${type}"`);
    const nextMethods = partial.methods !== undefined ? partial.methods : existing.methods;
    const nextWindowMethods = partial.windowMethods ?? existing.windowMethods;
    assertNoMethodNameCollision(type, nextMethods, nextWindowMethods);
    const nextParentClass = resolveEffectiveParentClass(partial, existing);
    this.store.set(type, {
      ...existing,
      methods: nextMethods,
      windowMethods: nextWindowMethods,
      onClose: partial.onClose ?? existing.onClose,
      renderXml: partial.renderXml ?? existing.renderXml,
      compressView: partial.compressView ?? existing.compressView,
      basicKnowledge: partial.basicKnowledge ?? existing.basicKnowledge,
      readable: partial.readable ?? existing.readable,
      consumedMessageIds: partial.consumedMessageIds ?? existing.consumedMessageIds,
      isBuiltinFeature: partial.isBuiltinFeature ?? existing.isBuiltinFeature,
      parentClass: nextParentClass,
    });
  }

  registerNewObjectType(
    type: ObjectType,
    definition: Partial<ObjectDefinition> & { methods?: Record<string, any> },
  ): void {
    const entries = definition.methods ?? {};
    assertNoMethodNameCollision(type, entries, definition.windowMethods);
    const effectiveParentClass = resolveEffectiveParentClass(definition, undefined);
    this.store.set(type, {
      type,
      onClose: undefined,
      renderXml: undefined,
      compressView: undefined,
      basicKnowledge: undefined,
      readable: undefined,
      ...definition,
      methods: entries,
      parentClass: effectiveParentClass,
    } as ObjectDefinition);
  }

  getObjectDefinition(type: ObjectType): ObjectDefinition {
    const entry = this.store.get(type);
    if (!entry) throw new Error(`getObjectDefinition: object type "${type}" not registered`);
    return entry;
  }

  has(type: string): boolean {
    return this.store.has(type as ObjectType);
  }

  isBuiltinFeatureType(type: ObjectType): boolean {
    const entry = this.store.get(type);
    if (!entry) return false;
    return entry.isBuiltinFeature === true;
  }

  resolveParentClassChain(startType: ObjectType): string[] {
    const chain: string[] = [];
    const seen = new Set<string>([startType]);
    const MAX_DEPTH = 64;
    let cur: string | undefined = startType;
    while (cur && chain.length < MAX_DEPTH) {
      const def = this.store.get(cur as ObjectType);
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

  lookupMethod(self: { type: ObjectType }, methodName: string): ObjectMethod | undefined {
    return this.resolveMethod(self.type, methodName);
  }

  lookupMethodEntry(
    self: { type: ObjectType },
    methodName: string,
  ): { entry: ObjectMethod; declaringType: ObjectType } | undefined {
    const selfDef = this.store.get(self.type);
    if (selfDef) {
      const selfEntry = selfDef.methods?.[methodName];
      if (selfEntry) return { entry: selfEntry, declaringType: self.type };
    }
    for (const parentType of this.resolveParentClassChain(self.type)) {
      const def = this.store.get(parentType as ObjectType);
      if (!def) continue;
      const entry = def.methods?.[methodName];
      if (entry) return { entry, declaringType: parentType as ObjectType };
    }
    return undefined;
  }

  resolveMethod(classId: string, methodName: string): ObjectMethod | undefined {
    const selfDef = this.store.get(classId as ObjectType);
    if (selfDef) {
      const selfEntry = selfDef.methods?.[methodName];
      if (selfEntry) return selfEntry;
    }
    for (const parentType of this.resolveParentClassChain(classId as ObjectType)) {
      const def = this.store.get(parentType as ObjectType);
      if (!def) continue;
      const entry = def.methods?.[methodName];
      if (entry) return entry;
    }
    return undefined;
  }

  /** 沿 parentClass 继承链查 window method（控制展示）。镜像 resolveMethod。 */
  lookupWindowMethod(self: { type: ObjectType }, name: string): WindowMethod | undefined {
    return this.resolveWindowMethod(self.type, name);
  }

  private resolveWindowMethod(type: string, name: string): WindowMethod | undefined {
    const selfDef = this.store.get(type as ObjectType);
    const own = selfDef?.windowMethods?.[name];
    if (own) return own;
    for (const ancestor of this.resolveParentClassChain(type as ObjectType)) {
      const inherited = this.store.get(ancestor as ObjectType)?.windowMethods?.[name];
      if (inherited) return inherited;
    }
    return undefined;
  }

  lookupConstructor(type: ObjectType): ObjectMethod | undefined {
    const def = this.store.get(type);
    if (!def) return undefined;
    const table = def.methods;
    if (!table) return undefined;
    for (const entry of Object.values(table)) {
      if (entry.kind === "constructor") return entry;
    }
    return undefined;
  }

  listRegisteredObjectTypes(): ObjectType[] {
    return Array.from(this.store.keys())
      .filter((t): t is ObjectType => t !== "relation")
      .sort();
  }

  assertAllObjectDefinitionsRegistered(): void {
    const missing: ObjectType[] = [];
    for (const [type, def] of this.store) {
      if (type === "relation") continue;
      if (!def.renderXml && !def.readable) missing.push(type);
    }
    if (missing.length > 0) {
      throw new Error(
        `ObjectRegistry: 以下 object type 缺少 renderXml 或 readable hook: ${missing.join(", ")}`,
      );
    }
  }

  resolveEffectiveVisibleType(type: ObjectType): string | undefined {
    if (RENDERABLE_VISIBLE_TYPES.has(type)) return type;
    for (const ancestor of this.resolveParentClassChain(type)) {
      if (RENDERABLE_VISIBLE_TYPES.has(ancestor)) return ancestor;
    }
    return undefined;
  }

  /** Snapshot all entries (useful for tests or cloning). */
  snapshot(): Array<[ObjectType, ObjectDefinition]> {
    return Array.from(this.store.entries()).map(([k, v]) => [k, { ...v }]);
  }

  /** Empty the registry (tests only). */
  __resetForTests(): void {
    this.store.clear();
    for (const [key, def] of BASE_TYPE_DEFINITIONS) {
      this.store.set(key as ObjectType, def);
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
          renderXml: def.renderXml ?? existing.renderXml,
          compressView: def.compressView ?? existing.compressView,
          basicKnowledge: def.basicKnowledge ?? existing.basicKnowledge,
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
 * command_exec, feishu_chat, feishu_doc, relation).
 *
 * Builtin modules populate this via side-effect imports at module load time
 * (e.g. `builtinRegistry.registerObjectType("file", {...})`).
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
