import type { OocClass, OocObjectInstance } from "./ooc-class.js";
import type {
  ObjectConstructor,
  ObjectLifecycleHook,
  ObjectMethod,
  WindowMethod,
  WindowClassDecl,
  ReadableModule,
  PersistableModule,
  VisibleServerModule,
  ReadableRender,
} from "../types";


/**
 * 同 class 内 object method 与 window method 不可重名（dispatch 入口统一 exec-by-name，
 * 重名导致优先级歧义）。注册期 fail-loud。
 */
function assertNoMethodNameCollision(cls: OocClass): void {
  const objectNames = new Set((cls.executable?.methods ?? []).map((m) => m.name));
  for (const decl of cls.readable?.window ?? []) {
    for (const wm of decl.window_methods) {
      if (objectNames.has(wm.name)) {
        throw new Error(
          `Method name "${wm.name}" registered as both object method and window method on "${cls.id}"`,
        );
      }
    }
  }
}


export class ClassRegistry {
  private readonly classes = new Map<string, OocClass>();

  constructor() {}

  register(
    cls: OocClass,
  ): void {
    const classId = cls.id
    assertNoMethodNameCollision(cls);
    this.classes.set(classId, cls);
  }

  getClass(classId: string): OocClass | undefined {
    return this.classes.get(classId);
  }

  hasClass(classId: string): boolean {
    return this.classes.has(classId);
  }

  resolveConstructor(classId: string): ObjectConstructor | undefined {
    const cls = this.classes.get(classId)
    return cls?.construct ?? (cls?.inheritClass ? this.resolveConstructor(cls.inheritClass) : undefined)
  }

  /** 解析 active 生命周期钩子 —— 沿继承链首个声明 active 的 class 胜出（同 resolveConstructor）。 */
  resolveActive(classId: string): ObjectLifecycleHook | undefined {
    const cls = this.classes.get(classId)
    return cls?.active ?? (cls?.inheritClass ? this.resolveActive(cls.inheritClass) : undefined)
  }

  /** 解析 unactive 生命周期钩子 —— 沿继承链首个声明 unactive 的 class 胜出（同 resolveConstructor）。 */
  resolveUnactive(classId: string): ObjectLifecycleHook | undefined {
    const cls = this.classes.get(classId)
    return cls?.unactive ?? (cls?.inheritClass ? this.resolveUnactive(cls.inheritClass) : undefined)
  }

  /** 解析单个 object method（按名，沿继承链首个命中）。 */
  resolveObjectMethod(classId: string, name: string): ObjectMethod | undefined {
    const cls = this.classes.get(classId)
    const found = cls?.executable?.methods.find((m) => m.name === name);
    if (found) return found;
    if (!cls?.inheritClass) return undefined;
    return this.resolveObjectMethod(cls.inheritClass, name);
  }

  /**
   * 合并沿继承链的全部 object method（子类同名覆盖父类）。
   * dispatch 渲染「这个对象可调哪些 object method」时用。
   */
  resolveObjectMethods(classId: string): ObjectMethod[] {
    const byName = new Map<string, ObjectMethod>();
    if (!classId) return Array.from(byName.values());
    const cls = this.classes.get(classId)
    for (const m of cls?.executable?.methods ?? []) {
      byName.set(m.name, m);
    }
    if (!cls?.inheritClass) return Array.from(byName.values());
    return this.resolveObjectMethods(cls.inheritClass).concat(Array.from(byName.values()));
  }

  resolveWindowMethod(classId: string, windowClass: string, methodName: string): WindowMethod | undefined {
    const cls = this.classes.get(classId)
    for (const decl of cls?.readable?.window ?? []) {
      const found = decl.window_methods.find((wm) => wm.name === methodName);
      if (found) return found;
    }
    if (!cls?.inheritClass) return undefined;
    return this.resolveWindowMethod(cls.inheritClass, windowClass, methodName);
  }

  resolveReadableRender(classId: string): ReadableRender | undefined {
    const cls = this.classes.get(classId);
    return cls?.readable?.readable ?? (cls?.inheritClass ? this.resolveReadableRender(cls.inheritClass) : undefined);
  }

  /** 解析 persistable 模块（沿继承链首个声明 persistable 的 class；无则走系统默认）。 */
  resolvePersistable(classId: string): PersistableModule | undefined {
    const cls = this.classes.get(classId);
    return cls?.persistable ?? (cls?.inheritClass ? this.resolvePersistable(cls.inheritClass) : undefined);
  }

  /** 解析 visibleServer 模块（沿继承链首个声明 visibleServer 的 class；无则 HTTP 控制面无可调方法）。 */
  resolveVisibleServer(classId: string): VisibleServerModule | undefined {
    const cls = this.classes.get(classId);
    return cls?.visible ?? (cls?.inheritClass ? this.resolveVisibleServer(cls.inheritClass) : undefined);
  }

  resolveWindowClass(classId: string, windowClass: string): WindowClassDecl | undefined {
    const cls = this.classes.get(classId);
    return cls?.readable?.window.find((w) => w.class === windowClass) ?? (cls?.inheritClass ? this.resolveWindowClass(cls.inheritClass, windowClass) : undefined);
  }

  iterRegisteredClasses() {
    return Array.from(this.classes.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }

  copyFrom(other: ClassRegistry): void {
    for (const [classId, def] of other.iterRegisteredClasses()) {
      const existing = this.classes.get(classId);
      if (existing) {
      } else {
        this.classes.set(classId, def);
      }
    }
  }
}

export class ObjectInsRegistry extends ClassRegistry{
  private readonly objects = new Map<string, OocObjectInstance>();

  constructor() {
    super();
  }

  getObject(id: string): OocObjectInstance | undefined {
    return this.objects.get(id);
  }

  setObject(id: string, obj: OocObjectInstance): void {
    this.objects.set(id, obj);
  }
}

export const builtinClassRegistry = new ClassRegistry();

export function createClassRegistry(): ClassRegistry {
  const reg = new ClassRegistry();
  reg.copyFrom(builtinClassRegistry);
  return reg;
}

const sessionObjectRegistries = new Map<string, ObjectInsRegistry>();
