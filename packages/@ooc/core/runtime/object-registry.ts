/**
 * ObjectRegistry — per-world class 注册表（Wave 4 对象模型重构）。
 *
 * store 元素从旧 `ObjectDefinition`（methods Record + 旧 readable + onClose/compressView/
 * consumedMessageIds 等 deferred hook）改为新契约 `OocClass`（construct / executable /
 * readable / persistable 四维度模块）+ 继承元信息，封装为 {@link RegisteredClass}。
 *
 * 核心职责：
 * - 注册 class：`register(classId, oocClass, meta?)`，class id 归一（strip `_builtin/` 前缀）。
 * - 单跳继承解析：object 经 ooc.class 继承**一个** class（非多级链、无 root 回退；class 不继承 class）；
 *   返回该对象可用的 construct / object method / window method / readable / persistable
 *   （self 优先、其单一父类次之；首个命中胜出）。
 *
 * **class id 归一**：`thread` 与 `_builtin/thread`、`agent` 与 `_builtin/agent` 命中同一类。
 * register / lookup 一律先 `normalizeClassId` strip `_builtin/` 前缀再操作 store。
 *
 * 双形态：`builtinRegistry` 单例（think/exec/render 默认）+ `createObjectRegistry()` 工厂
 * （per-world / 测试隔离，经 seedFrom(builtinRegistry) 拿到 side-effect 注册的全部 class）。
 *
 * **Wave 4 丢弃**：deferred hook（onClose / compressView / consumedMessageIds / onFormChange）
 * 不再存储——它们是 Wave 4 之后 re-home 的，不为兼容保留。
 */
import type { RegisteredClass } from "../_shared/types/registry.js";
import { filterMethodsByVisibility } from "../_shared/types/registry.js";
import type { MethodVisibilityContext } from "../_shared/types/registry.js";
import type { OocClass } from "./ooc-class.js";
import type {
  ObjectConstructor,
  ObjectMethod,
} from "../executable/contract.js";
import type {
  WindowMethod,
  WindowClassDecl,
  ReadableModule,
} from "../readable/contract.js";
import { resolveDefaultWindowMethod } from "../readable/default-window-methods.js";
import type { PersistableModule } from "../persistable/contract.js";

export type { RegisteredClass, MethodVisibilityContext };
export { filterMethodsByVisibility };

/**
 * class id 归一：strip `_builtin/` 前缀，使带/不带前缀命中同一键。
 * 其它前缀（world bare id / stone id）原样保留。
 */
export function normalizeClassId(classId: string): string {
  return classId.startsWith("_builtin/") ? classId.slice("_builtin/".length) : classId;
}

/**
 * 同 class 内 object method 与 window method 不可重名（dispatch 入口统一 exec-by-name，
 * 重名导致优先级歧义）。注册期 fail-loud。
 */
function assertNoMethodNameCollision(classId: string, cls: OocClass): void {
  const objectNames = new Set((cls.executable?.methods ?? []).map((m) => m.name));
  for (const decl of cls.readable?.window ?? []) {
    for (const wm of decl.window_methods) {
      if (objectNames.has(wm.name)) {
        throw new Error(
          `Method name "${wm.name}" registered as both object method and window method on "${classId}"`,
        );
      }
    }
  }
}

/**
 * root **窗**（每条 thread 的虚拟根容器，id=ROOT_WINDOW_ID）的投影器——空 content，
 * 外层包装 + 调度器 commands 块已足够表达。它是渲染期虚拟窗，**不是继承基类**
 * （对象模型无「万物之根」；class 不继承 class，object 经 ooc.class 单跳继承一个 class）。
 */
const rootWindowReadable: ReadableModule = {
  readable: () => ({ class: "root", content: [] }),
  window: [{ class: "root", object_methods: [], window_methods: [] }],
};

/**
 * Base anchors seeded into every new ObjectRegistry. Map key = 归一后的 class id。
 *
 * 只留两个非继承的运行时锚点；窗类型由各 builtins 包经 `register` side-effect import 自声明。
 * - `root`         : root **窗**（虚拟根容器）的投影器——非继承终点（`_builtin/root` 类已退役）。
 * - `method_exec`  : method 调用过程的临时载体（inline 持久化经 persistable.mode 声明）。
 */
const BASE_CLASS_ANCHORS: Array<[string, RegisteredClass]> = [
  ["root", { readable: rootWindowReadable }],
  ["method_exec", { parentClass: null, persistable: { mode: "inline" } }],
];

export class ObjectRegistry {
  private readonly store = new Map<string, RegisteredClass>();

  constructor() {
    for (const [key, def] of BASE_CLASS_ANCHORS) {
      this.store.set(key, { ...def });
    }
  }

  /**
   * 注册一个 class —— `index.ts` 的 `export const Class`（OocClass）+ 可选继承元信息。
   *
   * class id 归一（strip `_builtin/`）。已存在则**合并**（新模块字段覆盖、未传字段保留），
   * 支持窗类型分多次 side-effect import 增量补全 + 测试 seedFrom。
   */
  register(
    classId: string,
    cls: OocClass,
    meta?: { parentClass?: string | null },
  ): void {
    const key = normalizeClassId(classId);
    assertNoMethodNameCollision(key, cls);
    const existing = this.store.get(key);
    const nextParentClass =
      meta?.parentClass !== undefined ? meta.parentClass : existing?.parentClass;
    this.store.set(key, {
      ...existing,
      ...cls,
      construct: cls.construct ?? existing?.construct,
      executable: cls.executable ?? existing?.executable,
      readable: cls.readable ?? existing?.readable,
      persistable: cls.persistable ?? existing?.persistable,
      parentClass: nextParentClass,
    });
  }

  getClass(classId: string): RegisteredClass | undefined {
    return this.store.get(normalizeClassId(classId));
  }

  has(classId: string): boolean {
    return this.store.has(normalizeClassId(classId));
  }

  /**
   * 该 class 的实例是否 **inline 持久化**（运行态自有窗：整窗随所属 thread 的
   * thread-context.json inline 落盘、不写独立 state.json）。
   * 沿继承链查 `persistable.mode === "inline"`——取代旧的 `isBuiltinFeature` 标志，
   * 持久化策略归 class 自己的 persistable 维度声明，registry 不再硬编码标志位。
   */
  isInlinePersisted(classId: string): boolean {
    return this.resolvePersistable(classId)?.mode === "inline";
  }

  /**
   * object→class 单跳继承：返回 startClass 的（至多一个）父类 id。
   * class 不继承 class、无「万物之根」回退——parentClass 为 null/undefined 即无父（自身即终点）。
   */
  resolveParentClassChain(startClass: string): string[] {
    const parent = this.store.get(normalizeClassId(startClass))?.parentClass;
    return parent ? [normalizeClassId(parent)] : [];
  }

  /** 沿继承链自底向上的 class 序列（含自身在最前）。 */
  private selfThenChain(classId: string): string[] {
    const key = normalizeClassId(classId);
    return [key, ...this.resolveParentClassChain(key)];
  }

  /** 解析 constructor —— 沿继承链首个声明 construct 的 class 胜出。 */
  resolveConstructor(classId: string): ObjectConstructor | undefined {
    for (const cid of this.selfThenChain(classId)) {
      const ctor = this.store.get(cid)?.construct;
      if (ctor) return ctor;
    }
    return undefined;
  }

  /** 解析单个 object method（按名，沿继承链首个命中）。 */
  resolveObjectMethod(classId: string, name: string): ObjectMethod | undefined {
    for (const cid of this.selfThenChain(classId)) {
      const found = this.store.get(cid)?.executable?.methods.find((m) => m.name === name);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * 合并沿继承链的全部 object method（子类同名覆盖父类）。
   * dispatch 渲染「这个对象可调哪些 object method」时用。
   */
  resolveObjectMethods(classId: string): ObjectMethod[] {
    const byName = new Map<string, ObjectMethod>();
    // 父类在前、子类在后覆盖：倒序遍历链（最远祖先先写、自身最后覆盖）。
    for (const cid of this.selfThenChain(classId).reverse()) {
      for (const m of this.store.get(cid)?.executable?.methods ?? []) {
        byName.set(m.name, m);
      }
    }
    return Array.from(byName.values());
  }

  /**
   * 解析单个 window method（按名，沿继承链首个命中；查所有 window class 声明）。
   * class 自有声明未命中时回退**默认 window method 表**（compress/expand 等通用能力，
   * class 同名声明优先可 override）。
   */
  resolveWindowMethod(classId: string, name: string): WindowMethod | undefined {
    for (const cid of this.selfThenChain(classId)) {
      for (const decl of this.store.get(cid)?.readable?.window ?? []) {
        const found = decl.window_methods.find((wm) => wm.name === name);
        if (found) return found;
      }
    }
    return resolveDefaultWindowMethod(name);
  }

  /** 解析 readable 模块（沿继承链首个声明 readable 的 class）。 */
  resolveReadable(classId: string): ReadableModule | undefined {
    for (const cid of this.selfThenChain(classId)) {
      const r = this.store.get(cid)?.readable;
      if (r) return r;
    }
    return undefined;
  }

  /** 解析 persistable 模块（沿继承链首个声明 persistable 的 class；无则走系统默认）。 */
  resolvePersistable(classId: string): PersistableModule | undefined {
    for (const cid of this.selfThenChain(classId)) {
      const p = this.store.get(cid)?.persistable;
      if (p) return p;
    }
    return undefined;
  }

  /**
   * 解析某个投影 window class 的声明（object_methods 引用 + window_methods）。
   * readable 把对象投影成 window 后，dispatch / 渲染据此知道该窗展示哪些 method。
   */
  resolveWindowClass(classId: string, windowClass: string): WindowClassDecl | undefined {
    for (const cid of this.selfThenChain(classId)) {
      const found = this.store
        .get(cid)
        ?.readable?.window.find((w) => w.class === windowClass);
      if (found) return found;
    }
    return undefined;
  }

  listRegisteredClasses(): string[] {
    return Array.from(this.store.keys()).sort();
  }

  /** Snapshot all entries (tests / cloning). */
  snapshot(): Array<[string, RegisteredClass]> {
    return Array.from(this.store.entries()).map(([k, v]) => [k, { ...v }]);
  }

  /**
   * Reset to base anchors + side-effect-registered classes (tests only)。
   * 清空 → 重 seed 基类锚点 → seedFrom(builtinRegistry)（builtinRegistry 自身 reset 不自合并）。
   */
  __resetForTests(): void {
    this.store.clear();
    for (const [key, def] of BASE_CLASS_ANCHORS) {
      this.store.set(key, { ...def });
    }
    if (this !== builtinRegistry) this.seedFrom(builtinRegistry);
  }

  /** Copy all entries from another registry, merging模块字段（other 优先非空字段）。 */
  seedFrom(other: ObjectRegistry): void {
    for (const [classId, def] of other.snapshot()) {
      const existing = this.store.get(classId);
      if (existing) {
        this.store.set(classId, {
          ...existing,
          construct: def.construct ?? existing.construct,
          executable: def.executable ?? existing.executable,
          readable: def.readable ?? existing.readable,
          persistable: def.persistable ?? existing.persistable,
          parentClass:
            def.parentClass !== undefined ? def.parentClass : existing.parentClass,
        });
      } else {
        this.store.set(classId, def);
      }
    }
  }
}

/**
 * Module-level singleton holding builtin class definitions（root / method_exec / agent 基类锚点
 * + 各窗类型 file / plan / talk / search / knowledge / … 经 side-effect import 注册）。
 *
 * Builtin 包 populate this via side-effect import：每个 class 一处
 * `builtinRegistry.register(objectId, Class, { parentClass })`（inline 持久化经 Class.persistable.mode 声明）。
 * think / exec / render 默认用这个单例；per-world / 测试经 createObjectRegistry() seedFrom 拿到等价集合。
 */
export const builtinRegistry = new ObjectRegistry();

/**
 * 建一份 per-world / per-test registry：先 seed 基类锚点（constructor），再 seedFrom(builtinRegistry)
 * 拷入 side-effect import 注册的全部窗类型。任何真实入口都在此之前 load 完 builtins。
 */
export function createObjectRegistry(): ObjectRegistry {
  const reg = new ObjectRegistry();
  reg.seedFrom(builtinRegistry);
  return reg;
}
