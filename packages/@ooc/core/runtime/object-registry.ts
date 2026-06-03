/**
 * ObjectRegistry — per-world Object / Window 类型注册表。
 *
 * M1 (2026-06-02): 从 executable/windows/_shared/registry.ts 抽出。
 * 原有 module-level 导出保留为对 `defaultObjectRegistry` 的 thin wrapper。
 */
import type {
  CommandTableEntry,
  ObjectMethod,
} from "../executable/windows/_shared/command-types.js";
import type {
  CompressViewHook,
  MethodVisibilityContext,
  ObjectDefinition,
  ObjectType,
  OnCloseContext,
  OnCloseHook,
  ReadableFn,
  RenderContext,
  RenderHook,
  WindowType,
  WindowTypeDefinition,
} from "../executable/windows/_shared/registry.js";
import type { ContextWindow } from "../executable/windows/_shared/types.js";

export type {
  ObjectDefinition,
  ObjectType,
  WindowType,
  WindowTypeDefinition,
  ObjectMethod,
  CommandTableEntry,
  ContextWindow,
  OnCloseContext,
  OnCloseHook,
  RenderContext,
  RenderHook,
  ReadableFn,
  CompressViewHook,
  MethodVisibilityContext,
};

const RENDERABLE_VISIBLE_TYPES = new Set([
  "root", "command_exec", "do", "todo", "talk", "program",
  "file", "knowledge", "search", "relation", "skill_index",
  "feishu_chat", "feishu_doc", "plan",
]);

function resolveEffectiveParentClass(
  input: { parentClass?: string | null; prototype?: string },
  fallback: ObjectDefinition | undefined,
): string | null | undefined {
  if ("parentClass" in input) return input.parentClass;
  if ("prototype" in input && input.prototype !== undefined) return input.prototype;
  return fallback?.parentClass;
}

/** Base types seeded into every new ObjectRegistry. */
const BASE_TYPE_DEFINITIONS: Array<[string, ObjectDefinition]> = [
  ["root", {
    type: "root", commands: {}, methods: {}, parentClass: null,
  } as ObjectDefinition],
  ["command_exec", {
    type: "command_exec", commands: {}, methods: {}, parentClass: null,
  } as ObjectDefinition],
  ["method_exec", {
    type: "method_exec", commands: {}, methods: {}, parentClass: null,
  } as ObjectDefinition],
  ["do", { type: "do", commands: {}, methods: {} } as ObjectDefinition],
  ["todo", { type: "todo", commands: {}, methods: {} } as ObjectDefinition],
  ["talk", { type: "talk", commands: {}, methods: {} } as ObjectDefinition],
  ["program", { type: "program", commands: {}, methods: {} } as ObjectDefinition],
  ["file", { type: "file", commands: {}, methods: {} } as ObjectDefinition],
  ["knowledge", { type: "knowledge", commands: {}, methods: {} } as ObjectDefinition],
  ["search", { type: "search", commands: {}, methods: {} } as ObjectDefinition],
  ["relation", { type: "relation", commands: {}, methods: {} } as ObjectDefinition],
  ["skill_index", { type: "skill_index", commands: {}, methods: {} } as ObjectDefinition],
  ["feishu_chat", { type: "feishu_chat", commands: {}, methods: {} } as ObjectDefinition],
  ["feishu_doc", { type: "feishu_doc", commands: {}, methods: {} } as ObjectDefinition],
  ["plan", { type: "plan", commands: {}, methods: {} } as ObjectDefinition],
];

export class ObjectRegistry {
  private readonly store = new Map<WindowType, WindowTypeDefinition>();

  constructor() {
    for (const [key, def] of BASE_TYPE_DEFINITIONS) {
      this.store.set(key as WindowType, def as unknown as WindowTypeDefinition);
    }
  }

  /** @deprecated Use registerObjectType instead. */
  registerWindowType(type: WindowType, partial: Partial<Omit<WindowTypeDefinition, "type">>): void {
    const existing = this.store.get(type);
    if (!existing) throw new Error(`registerWindowType: unknown window type "${type}"`);
    const nextCommands = partial.commands !== undefined ? partial.commands : existing.commands;
    const nextParentClass = resolveEffectiveParentClass(partial, existing as ObjectDefinition);
    this.store.set(type, {
      ...existing,
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

  registerObjectType(type: ObjectType, partial: Partial<Omit<ObjectDefinition, "type">>): void {
    const existing = this.store.get(type) as ObjectDefinition | undefined;
    if (!existing) throw new Error(`registerObjectType: unknown object type "${type}"`);
    const nextEntries =
      partial.methods !== undefined
        ? partial.methods
        : partial.commands !== undefined
          ? partial.commands
          : existing.methods;
    const nextParentClass = resolveEffectiveParentClass(partial, existing);
    this.store.set(type, {
      ...existing,
      commands: nextEntries,
      methods: nextEntries,
      onClose: partial.onClose ?? existing.onClose,
      renderXml: partial.renderXml ?? existing.renderXml,
      compressView: partial.compressView ?? existing.compressView,
      basicKnowledge: partial.basicKnowledge ?? existing.basicKnowledge,
      prototype: partial.prototype ?? existing.prototype,
      readable: partial.readable ?? existing.readable,
      isBuiltinFeature: partial.isBuiltinFeature ?? existing.isBuiltinFeature,
      parentClass: nextParentClass,
    } as ObjectDefinition);
  }

  registerNewObjectType(
    type: ObjectType,
    definition: Partial<ObjectDefinition> & { commands?: Record<string, any>; methods?: Record<string, any> },
  ): void {
    const entries = definition.methods ?? definition.commands ?? {};
    const effectiveParentClass = resolveEffectiveParentClass(definition, undefined);
    this.store.set(type, {
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

  /** @deprecated Use getObjectDefinition instead. */
  getWindowTypeDefinition(type: WindowType): WindowTypeDefinition {
    const entry = this.store.get(type);
    if (!entry) throw new Error(`getWindowTypeDefinition: window type "${type}" not registered`);
    return entry;
  }

  getObjectDefinition(type: ObjectType): ObjectDefinition {
    const entry = this.store.get(type) as ObjectDefinition | undefined;
    if (!entry) throw new Error(`getObjectDefinition: object type "${type}" not registered`);
    return entry;
  }

  has(type: string): boolean {
    return this.store.has(type as WindowType);
  }

  isBuiltinFeatureType(type: ObjectType): boolean {
    const entry = this.store.get(type) as ObjectDefinition | undefined;
    if (!entry) return false;
    return entry.isBuiltinFeature === true;
  }

  resolveParentClassChain(startType: ObjectType): string[] {
    const chain: string[] = [];
    const seen = new Set<string>([startType]);
    const MAX_DEPTH = 64;
    let cur: string | undefined = startType;
    while (cur && chain.length < MAX_DEPTH) {
      const def = this.store.get(cur as ObjectType) as ObjectDefinition | undefined;
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

  lookupMethod(parentWindow: { type: ObjectType }, methodName: string): ObjectMethod | undefined {
    return this.resolveMethod(parentWindow.type, methodName);
  }

  lookupMethodEntry(
    parentWindow: { type: ObjectType },
    methodName: string,
  ): { entry: ObjectMethod; declaringType: ObjectType } | undefined {
    const selfDef = this.store.get(parentWindow.type) as ObjectDefinition | undefined;
    if (selfDef) {
      const selfEntry = selfDef.methods?.[methodName] ?? selfDef.commands?.[methodName];
      if (selfEntry) return { entry: selfEntry, declaringType: parentWindow.type };
    }
    for (const parentType of this.resolveParentClassChain(parentWindow.type)) {
      const def = this.store.get(parentType as ObjectType) as ObjectDefinition | undefined;
      if (!def) continue;
      const entry = def.methods?.[methodName] ?? def.commands?.[methodName];
      if (entry) return { entry, declaringType: parentType as ObjectType };
    }
    return undefined;
  }

  resolveMethod(classId: string, methodName: string): ObjectMethod | undefined {
    const selfDef = this.store.get(classId as ObjectType) as ObjectDefinition | undefined;
    if (selfDef) {
      const selfEntry = selfDef.methods?.[methodName] ?? selfDef.commands?.[methodName];
      if (selfEntry) return selfEntry;
    }
    for (const parentType of this.resolveParentClassChain(classId as ObjectType)) {
      const def = this.store.get(parentType as ObjectType) as ObjectDefinition | undefined;
      if (!def) continue;
      const entry = def.methods?.[methodName] ?? def.commands?.[methodName];
      if (entry) return entry;
    }
    return undefined;
  }

  lookupConstructor(type: ObjectType): ObjectMethod | undefined {
    const def = this.store.get(type) as ObjectDefinition | undefined;
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

  /** @deprecated Use listRegisteredObjectTypes instead. */
  listRegisteredWindowTypes(): WindowType[] {
    return Array.from(this.store.keys()).sort();
  }

  listRegisteredObjectTypes(): ObjectType[] {
    return Array.from(this.store.keys())
      .filter((t): t is ObjectType => t !== "relation")
      .sort();
  }

  /** @deprecated Use assertAllObjectDefinitionsRegistered instead. */
  assertAllRenderHooksRegistered(): void {
    const missing: WindowType[] = [];
    for (const [type, def] of this.store) {
      if (!def.renderXml) missing.push(type);
    }
    if (missing.length > 0) {
      throw new Error(
        `WindowRegistry: 以下 window type 缺少 renderXml hook: ${missing.join(", ")}`,
      );
    }
  }

  assertAllObjectDefinitionsRegistered(): void {
    const missing: ObjectType[] = [];
    for (const [type, def] of this.store) {
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

  resolveEffectiveVisibleType(type: ObjectType): string | undefined {
    if (RENDERABLE_VISIBLE_TYPES.has(type)) return type;
    for (const ancestor of this.resolveParentClassChain(type)) {
      if (RENDERABLE_VISIBLE_TYPES.has(ancestor)) return ancestor;
    }
    return undefined;
  }

  /** Snapshot all entries (useful for tests or cloning). */
  snapshot(): Array<[WindowType, WindowTypeDefinition]> {
    return Array.from(this.store.entries()).map(([k, v]) => [k, { ...v }]);
  }

  /** Empty the registry (tests only). */
  __resetForTests(): void {
    this.store.clear();
    for (const [key, def] of BASE_TYPE_DEFINITIONS) {
      this.store.set(key as WindowType, def as unknown as WindowTypeDefinition);
    }
  }
}

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
        if (method.public === true) filtered[name] = method;
        break;
      case "ui":
        if (method.for_ui_access === true) filtered[name] = method;
        break;
    }
  }
  return filtered;
}

/** module-level 默认实例——所有原 registry.ts 导出的 wrapper 函数委托给它。 */
export const defaultObjectRegistry = new ObjectRegistry();

export function createObjectRegistry(): ObjectRegistry {
  return new ObjectRegistry();
}
