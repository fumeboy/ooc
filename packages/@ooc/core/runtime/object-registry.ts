/**
 * Class & Object 注册表 —— OOC runtime 的核心 registry。
 *
 * 设计权威：`.ooc-world-meta/.../children/object/self.md`（对象模型核心 1-10）。
 *
 * 两层结构：
 * - **`ClassRegistry`** —— class（定义）注册表：进程级 builtin singleton + per-stone 派生。
 *   提供「沿单跳继承链解析维度模块」的泛型 seam (`resolveExecutable` / `resolveReadable` /
 *   `resolvePersistable` / `resolveVisibleServer` / `resolveThinkable` / `resolveConstructor` /
 *   `resolveActive` / `resolveUnactive`)。core 经此泛型解析 class 程序，不具名 import 具体 class。
 *
 * - **`ObjectInsRegistry extends ClassRegistry`** —— 一个 session 内的 object **实例**注册表：
 *   `(objectId → OocObjectInstance)`。context window (`OocObjectRef`) 经 `ref.id` 解析到这里
 *   取业务 data。owner = sessionId、按 session 一份；进程级 `sessionRegistries` 持有。
 *   scheduler 经 `iter()` 扫一个 session 的全部对象筛 thread；job 退出由调用方
 *   `releaseSessionRegistry(sessionId)` 释放。
 */
import type { OocClass, OocObjectInstance } from "./ooc-class.js";
import type {
  ObjectConstructor,
  ObjectLifecycleHook,
  ObjectMethod,
  WindowMethod,
  WindowClassDecl,
  ReadableModule,
  ReadableRender,
  PersistableModule,
  VisibleServerModule,
  ThinkableModule,
} from "../types";

// ─────────────────────────── ClassRegistry ───────────────────────────

/**
 * 同 class 内 object method 与 window method 不可重名（dispatch 入口统一 exec-by-name，
 * 重名会有优先级歧义）。注册期 fail-loud。
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

/**
 * Class 注册表 —— 按 class id 注册 OocClass 定义、沿单跳继承链泛型解析维度模块。
 *
 * 解析约定：每个 `resolveXxx(classId)` 先查本类的对应槽，缺则沿 `inheritClass` 链向上找。
 * 子类同名 method 覆盖父类（见 `resolveObjectMethods`）。继承不可多跳——见对象模型核心 2。
 */
export class ClassRegistry {
  protected readonly classes = new Map<string, OocClass>();

  register(cls: OocClass): void {
    assertNoMethodNameCollision(cls);
    this.classes.set(cls.id, cls);
  }

  getClass(classId: string): OocClass | undefined {
    return this.classes.get(classId);
  }

  hasClass(classId: string): boolean {
    return this.classes.has(classId);
  }

  /** 沿继承链解析 construct。 */
  resolveConstructor(classId: string): ObjectConstructor | undefined {
    const cls = this.classes.get(classId);
    return cls?.construct ?? (cls?.inheritClass ? this.resolveConstructor(cls.inheritClass) : undefined);
  }

  /** 沿继承链解析 active 钩子。 */
  resolveActive(classId: string): ObjectLifecycleHook | undefined {
    const cls = this.classes.get(classId);
    return cls?.active ?? (cls?.inheritClass ? this.resolveActive(cls.inheritClass) : undefined);
  }

  /** 沿继承链解析 unactive 钩子。 */
  resolveUnactive(classId: string): ObjectLifecycleHook | undefined {
    const cls = this.classes.get(classId);
    return cls?.unactive ?? (cls?.inheritClass ? this.resolveUnactive(cls.inheritClass) : undefined);
  }

  /** 解析单个 object method（按名，沿继承链首个命中）。 */
  resolveObjectMethod(classId: string, name: string): ObjectMethod | undefined {
    const cls = this.classes.get(classId);
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
    const cls = this.classes.get(classId);
    if (!cls) return [];
    const inherited = cls.inheritClass ? this.resolveObjectMethods(cls.inheritClass) : [];
    for (const m of inherited) byName.set(m.name, m);
    for (const m of cls.executable?.methods ?? []) byName.set(m.name, m);
    return Array.from(byName.values());
  }

  /** 解析 window method（按 windowClass + methodName，沿继承链）。 */
  resolveWindowMethod(
    classId: string,
    windowClass: string,
    methodName: string,
  ): WindowMethod | undefined {
    const cls = this.classes.get(classId);
    for (const decl of cls?.readable?.window ?? []) {
      if (decl.class !== windowClass) continue;
      const found = decl.window_methods.find((wm) => wm.name === methodName);
      if (found) return found;
    }
    if (!cls?.inheritClass) return undefined;
    return this.resolveWindowMethod(cls.inheritClass, windowClass, methodName);
  }

  /** 解析 window class 声明（render 用：要知道某窗 surface 哪些 object method）。 */
  resolveWindowClass(classId: string, windowClass: string): WindowClassDecl | undefined {
    const cls = this.classes.get(classId);
    return (
      cls?.readable?.window.find((w) => w.class === windowClass) ??
      (cls?.inheritClass ? this.resolveWindowClass(cls.inheritClass, windowClass) : undefined)
    );
  }

  /** 解析 readable 模块整份（renderer 调；含 render fn + window decl 列表）。 */
  resolveReadable(classId: string): ReadableModule | undefined {
    const cls = this.classes.get(classId);
    return cls?.readable ?? (cls?.inheritClass ? this.resolveReadable(cls.inheritClass) : undefined);
  }

  /** 解析 readable render（仅 render fn）。 */
  resolveReadableRender(classId: string): ReadableRender | undefined {
    return this.resolveReadable(classId)?.readable;
  }

  /** 解析 persistable 模块（沿继承链；无则走系统默认）。 */
  resolvePersistable(classId: string): PersistableModule | undefined {
    const cls = this.classes.get(classId);
    return cls?.persistable ?? (cls?.inheritClass ? this.resolvePersistable(cls.inheritClass) : undefined);
  }

  /** 解析 visible/server 模块（HTTP 控制面 callMethod 入口）。 */
  resolveVisibleServer(classId: string): VisibleServerModule | undefined {
    const cls = this.classes.get(classId);
    return cls?.visible ?? (cls?.inheritClass ? this.resolveVisibleServer(cls.inheritClass) : undefined);
  }

  /** 解析 thinkable 模块（仅 thread 类实际声明；scheduler 经此调 think / onSchedulerTick）。 */
  resolveThinkable(classId: string): ThinkableModule | undefined {
    const cls = this.classes.get(classId);
    return cls?.thinkable ?? (cls?.inheritClass ? this.resolveThinkable(cls.inheritClass) : undefined);
  }

  iterRegisteredClasses(): Array<[string, OocClass]> {
    return Array.from(this.classes.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }

  /** 把 other 的 class 拷进本表（已存在的不覆盖）。 */
  copyFrom(other: ClassRegistry): void {
    for (const [classId, def] of other.iterRegisteredClasses()) {
      if (!this.classes.has(classId)) this.classes.set(classId, def);
    }
  }
}

// ─────────────────────────── ObjectInsRegistry ───────────────────────────

/**
 * 一个 session 内的 object **实例**注册表（按 `objectId → OocObjectInstance`）。
 *
 * `context window`（OocObjectRef）经 `ref.id` 来这取业务 data；同 objectId 多窗 ⇒ 同一表项 ⇒
 * 读同一份 data。**仅持运行态镜像**，磁盘真相在各 object 的 `data.json` / `thread.json`。
 *
 * **继承自 ClassRegistry**——一个 session 既要知道有哪些 class 注册了（resolveXxx），也要知道
 * 自己 hydrate 出了哪些实例（getObject / iter）。
 */
export class ObjectInsRegistry extends ClassRegistry {
  private readonly objects = new Map<string, OocObjectInstance>();

  /** 取一个对象实例。 */
  getObject(id: string): OocObjectInstance | undefined {
    return this.objects.get(id);
  }

  /** 登记/更新一个对象实例（hydrate / instantiate 调用）。 */
  setObject(instance: OocObjectInstance): void {
    this.objects.set(instance.id, instance);
  }

  /** 移除一个对象实例（lifecycle delete:true / 末-ref-evict）。 */
  removeObject(id: string): void {
    this.objects.delete(id);
  }

  /** 遍历所有对象实例（scheduler 扫 thread / debug / cleanup）。 */
  iterObjects(cb: (instance: OocObjectInstance) => void): void {
    for (const inst of this.objects.values()) cb(inst);
  }
}

// ─────────────────────────── 进程级 singletons ───────────────────────────

/** 进程级 builtin class 注册表 —— 所有 OOC class 一处装载（见 object-register.builtins.ts）。 */
export const builtinClassRegistry = new ClassRegistry();

/** 派生一个新 ClassRegistry，拷贝 builtin（per-stone 扩展时用）。 */
export function createClassRegistry(): ClassRegistry {
  const reg = new ClassRegistry();
  reg.copyFrom(builtinClassRegistry);
  return reg;
}

/** sessionId → 该 session 的 ObjectInsRegistry。 */
const sessionRegistries = new Map<string, ObjectInsRegistry>();

/**
 * 取（惰性建）某 sessionId 的 ObjectInsRegistry —— 继承自 builtinClassRegistry 的 class 集。
 *
 * worker 一个 job 进入 session 时调；同 sessionId 多次调返回同一实例（运行态镜像）。
 */
export function getSessionRegistry(sessionId: string): ObjectInsRegistry {
  let reg = sessionRegistries.get(sessionId);
  if (!reg) {
    reg = new ObjectInsRegistry();
    reg.copyFrom(builtinClassRegistry);
    sessionRegistries.set(sessionId, reg);
  }
  return reg;
}

/**
 * 释放一个 session 的 ObjectInsRegistry —— job 退出时调，防进程级表泄漏。
 *
 * 磁盘真相仍在，下次 hydrate 重新建表；本表只是运行态镜像。
 */
export function releaseSessionRegistry(sessionId: string): void {
  sessionRegistries.delete(sessionId);
}

/**
 * 遍历一个 session 里全部对象实例 —— scheduler / refcount 计算 / debug / cleanup 用。
 *
 * 等价于 `getSessionRegistry(sessionId).iterObjects(cb)`，但不强制建空表（sessionId 没 hydrate
 * 过则直接 no-op）。
 */
export function iterateSessionObjectTable(
  sessionId: string,
  cb: (instance: OocObjectInstance) => void,
): void {
  const reg = sessionRegistries.get(sessionId);
  if (!reg) return;
  reg.iterObjects(cb);
}
