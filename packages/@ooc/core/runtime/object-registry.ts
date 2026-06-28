/**
 * Class & Object 注册表 —— OOC runtime 的核心 registry。
 *
 * 设计权威：`.ooc-world-meta/.../children/object/self.md`（对象模型核心 1-10）。
 *
 * 两层结构：
 * - **`ClassRegistry`** —— class（定义）注册表：进程级 builtin singleton + per-stone 派生。
 *   提供「本类直查维度模块」的泛型 seam (`resolveExecutable` / `resolveReadable` /
 *   `resolvePersistable` / `resolveVisibleServer` / `resolveThinkable` / `resolveConstructor` /
 *   `resolveActive` / `resolveUnactive`)。core 经此泛型解析 class 程序，不具名 import 具体 class。
 *
 *   **OOC 协议层不内建任何继承 / dispatch chain 机制**（object 模型核心 2）：注册扁平的 class，
 *   resolveXxx 只查本类的对应槽。class 想复用另一个 class 的能力，由其 `index.ts` 用 TS 标准
 *   `import` + 对象 `spread`（或 method 级 import + 显式调）在源码侧完成。
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
  ObjectGuideMethod,
  ObjectLifecycleHook,
  OnReloadHook,
  ObjectMethod,
  WindowMethod,
  WindowViewDecl,
  ReadableModule,
  ReadableRender,
  PersistableModule,
  VisibleServerModule,
  ThinkableModule,
  ExecutableModule,
} from "../types";

// ─────────────────────────── ClassRegistry ───────────────────────────

/** 默认投影 view 的保留名 —— 单视角 class 的强约束（见 readable 维度 self.md）。 */
export const DEFAULT_WINDOW_VIEW = "default";

/**
 * 注册期 fail-loud 校验。两类查重均不可放过：
 *
 * 1. **object methods 列表内同名重复** —— 子 class 经 spread + concat 父 methods 时容易漏 filter，
 *    放任会让 dispatch 按数组顺序拿到首个或末个不定，调试地狱。
 * 2. **window methods 列表内同名重复**（同 window class 内）—— 同理。
 * 3. **object method 与 window method 跨类型重名** —— exec-by-name 统一入口下有优先级歧义。
 */
function assertNoMethodNameCollision(cls: OocClass): void {
  // 1. object methods 内部自查重
  const objectMethods = cls.executable?.methods ?? [];
  const objectSeen = new Set<string>();
  for (const m of objectMethods) {
    if (objectSeen.has(m.name)) {
      throw new Error(
        `Duplicate object method name "${m.name}" on "${cls.id}" (likely a missing filter in spread+concat)`,
      );
    }
    objectSeen.add(m.name);
  }

  // 2. 各 window view 内 window methods 自查重
  for (const decl of cls.readable?.window ?? []) {
    const windowSeen = new Set<string>();
    for (const wm of decl.window_methods) {
      if (windowSeen.has(wm.name)) {
        throw new Error(
          `Duplicate window method name "${wm.name}" on window view "${decl.view}" of "${cls.id}"`,
        );
      }
      windowSeen.add(wm.name);
    }
  }

  // 3. object vs window 跨类型重名
  for (const decl of cls.readable?.window ?? []) {
    for (const wm of decl.window_methods) {
      if (objectSeen.has(wm.name)) {
        throw new Error(
          `Method name "${wm.name}" registered as both object method and window method on "${cls.id}"`,
        );
      }
    }
  }
}

/**
 * 注册期 fail-loud 校验（issue 2026-06-26-object-guide-method-split） —— 扩展 method/guide/window
 * 三侧 cohesion：
 *
 * 1. **methods / guides 各自内部按 name 自查重**——guides 与 methods 一样按 name dispatch，重名歧义。
 * 2. **methods 与 guides 跨域不可重名**——共享 exec-by-name 入口，命中谁不确定。
 * 3. **guides 与 window methods 跨域不可重名**——见 assertNoMethodNameCollision 同因。
 * 4. **每个 window decl 的 object_methods / guide_methods 引用必须能在 ExecutableModule 内解析**——
 *    悬空引用 fail-loud；super 等下游按白名单 surface 依赖此约束。
 */
function assertExecutableMethodGuideCohesion(cls: OocClass): void {
  const executable: ExecutableModule | undefined = cls.executable;
  const methods = executable?.methods ?? [];
  const guides = executable?.guides ?? [];

  // 1. guides 内部按 name 自查重
  const guideSeen = new Set<string>();
  for (const g of guides) {
    if (guideSeen.has(g.name)) {
      throw new Error(
        `Duplicate guide method name "${g.name}" on "${cls.id}"`,
      );
    }
    guideSeen.add(g.name);
  }

  // 2. method vs guide 跨域不可重名
  const methodNames = new Set(methods.map((m) => m.name));
  for (const g of guides) {
    if (methodNames.has(g.name)) {
      throw new Error(
        `Name "${g.name}" registered as both object method and guide method on "${cls.id}"`,
      );
    }
  }

  // 3. guide vs window method 跨域不可重名
  for (const decl of cls.readable?.window ?? []) {
    for (const wm of decl.window_methods) {
      if (guideSeen.has(wm.name)) {
        throw new Error(
          `Name "${wm.name}" registered as both guide method and window method on "${cls.id}"`,
        );
      }
    }
  }

  // 4. window decl 的 object_methods / guide_methods 引用必须可解析（悬空 fail-loud）
  for (const decl of cls.readable?.window ?? []) {
    for (const mname of decl.object_methods ?? []) {
      if (!methodNames.has(mname)) {
        throw new Error(
          `Window view "${decl.view}" of "${cls.id}" references unknown object method "${mname}"`,
        );
      }
    }
    for (const gname of decl.guide_methods ?? []) {
      if (!guideSeen.has(gname)) {
        throw new Error(
          `Window view "${decl.view}" of "${cls.id}" references unknown guide method "${gname}"`,
        );
      }
    }
  }
}

/**
 * 注册期 readable.window decl 一致性校验（issue 2026-06-26 default window view convention）：
 *
 * 1. **window[] 内 `view` 字段不重复** —— 否则 resolveWindowView / resolveWindowMethod 会静默取
 *    数组首个,造成 dispatch 歧义；fail-loud 让漂移立刻暴露。
 * 2. **单视角 class（window[] 长度 = 1）**：唯一 decl 的 `view` 必须为 `"default"`。
 *    单视角默认投影统一命名,未指明 view 时调用方可不查直接取 default。
 * 3. **多视角 class（window[] 长度 > 1）**：豁免 default 强约束——多视角通常每条都具名语义
 *    （`default` / `super` 等）,不强求兜底；调用方未指明 view 又无 default decl 时
 *    `resolveDefaultWindowView` 会回退 readable.md 名片或落 placeholder。
 *
 * （无 readable 模块的 class 跳过本校验。）
 */
function assertReadableWindowCohesion(cls: OocClass): void {
  const decls = cls.readable?.window ?? [];
  if (decls.length === 0) return;

  // 1. view 唯一
  const seen = new Set<string>();
  for (const decl of decls) {
    if (seen.has(decl.view)) {
      throw new Error(
        `Duplicate window view "${decl.view}" on "${cls.id}" readable.window[] (resolveWindowView would silently pick the first)`,
      );
    }
    seen.add(decl.view);
  }

  // 2. 单视角 → 必须 default
  if (decls.length === 1) {
    const only = decls[0]!;
    if (only.view !== DEFAULT_WINDOW_VIEW) {
      throw new Error(
        `Single-view readable class "${cls.id}" must declare its sole window with view:"${DEFAULT_WINDOW_VIEW}" (got "${only.view}")`,
      );
    }
  }
  // 3. 多视角 → 不强制（豁免）
}

/**
 * Class 注册表 —— 按 class id 注册 OocClass 定义、本类直查各维度模块。
 *
 * 解析约定：每个 `resolveXxx(classId)` 只查本类的对应槽，**不沿任何继承链 fallback**。
 * 子 class 要复用父能力，由子的 `index.ts` 在源码侧 `import` 父 class 后 `spread`
 * （或方法级 `import` 父函数 + 显式调）完成——OOC 协议层不感知"父子关系"。
 */
export class ClassRegistry {
  protected readonly classes = new Map<string, OocClass>();

  register(cls: OocClass): void {
    assertNoMethodNameCollision(cls);
    assertExecutableMethodGuideCohesion(cls);
    assertReadableWindowCohesion(cls);
    this.classes.set(cls.id, cls);
  }

  getClass(classId: string): OocClass | undefined {
    return this.classes.get(classId);
  }

  hasClass(classId: string): boolean {
    return this.classes.has(classId);
  }

  /** 本类直查 construct。 */
  resolveConstructor(classId: string): ObjectConstructor | undefined {
    return this.classes.get(classId)?.construct;
  }

  /** 本类直查 active 钩子（issue 2026-06-28：lifecycle 模块槽下，路径加一步 .lifecycle.*）。 */
  resolveActive(classId: string): ObjectLifecycleHook | undefined {
    return this.classes.get(classId)?.lifecycle?.active;
  }

  /** 本类直查 unactive 钩子（issue 2026-06-28：lifecycle 模块槽下）。 */
  resolveUnactive(classId: string): ObjectLifecycleHook | undefined {
    return this.classes.get(classId)?.lifecycle?.unactive;
  }

  /** 本类直查 on_reload 钩子（issue 2026-06-28：hot-reload 触发的资源/内存态重建钩）。 */
  resolveOnReload(classId: string): OnReloadHook | undefined {
    return this.classes.get(classId)?.lifecycle?.on_reload;
  }

  /** 本类直查单个 object method（按 name）。子若想复用父 method，自己在 index.ts spread/import 后挂上。 */
  resolveObjectMethod(classId: string, name: string): ObjectMethod | undefined {
    return this.classes.get(classId)?.executable?.methods.find((m) => m.name === name);
  }

  /** 本类直查全部 object methods。dispatch 渲染「这个对象可调哪些 method」时用。 */
  resolveObjectMethods(classId: string): ObjectMethod[] {
    return this.classes.get(classId)?.executable?.methods ?? [];
  }

  /**
   * 本类直查单个 **guide method**（按 name）。dispatch 入口在 resolveObjectMethod 未命中时回退到此查
   * （见 ThreadRuntime.exec）。
   */
  resolveObjectGuideMethod(classId: string, name: string): ObjectGuideMethod | undefined {
    return this.classes.get(classId)?.executable?.guides?.find((g) => g.name === name);
  }

  /** 本类直查全部 guide methods。 */
  resolveObjectGuideMethods(classId: string): ObjectGuideMethod[] {
    return this.classes.get(classId)?.executable?.guides ?? [];
  }

  /** 本类直查 window method（按 windowView + methodName）。 */
  resolveWindowMethod(
    classId: string,
    windowView: string,
    methodName: string,
  ): WindowMethod | undefined {
    const decl = this.classes.get(classId)?.readable?.window.find((w) => w.view === windowView);
    return decl?.window_methods.find((wm) => wm.name === methodName);
  }

  /** 本类直查 window view 声明。 */
  resolveWindowView(classId: string, windowView: string): WindowViewDecl | undefined {
    return this.classes.get(classId)?.readable?.window.find((w) => w.view === windowView);
  }

  /**
   * 本类直查「默认投影 window view 声明」—— 单视角 class 兜底入口（issue 2026-06-26）。
   *
   * 1. 优先返回 `view === "default"` 的 decl（单视角强约束保证存在）。
   * 2. 多视角 class 若无 default decl 时返 undefined；调用方应回退到该 class 的 `readable.md` 名片
   *    （兑现 readable 核心 7：静态名片是投影的最低优先级回退）—— 名片回退由 readable 渲染层负责,
   *    本 seam 只做注册表层 fail-fast。
   */
  resolveDefaultWindowView(classId: string): WindowViewDecl | undefined {
    return this.resolveWindowView(classId, DEFAULT_WINDOW_VIEW);
  }

  /** 本类直查 readable 模块整份。 */
  resolveReadable(classId: string): ReadableModule | undefined {
    return this.classes.get(classId)?.readable;
  }

  /** 本类直查 readable render。 */
  resolveReadableRender(classId: string): ReadableRender | undefined {
    return this.resolveReadable(classId)?.readable;
  }

  /** 本类直查 persistable（无则走系统默认）。 */
  resolvePersistable(classId: string): PersistableModule | undefined {
    return this.classes.get(classId)?.persistable;
  }

  /** 本类直查 versioned_fields（缺省 = 空数组 = 全部字段非版本化）。 */
  resolveVersionedFields(classId: string): readonly string[] {
    return this.classes.get(classId)?.versioned_fields ?? [];
  }

  /** 本类直查 visible/server（HTTP 控制面 callMethod 入口）。 */
  resolveVisibleServer(classId: string): VisibleServerModule | undefined {
    return this.classes.get(classId)?.visible;
  }

  /** 本类直查 thinkable（仅 thread 类实际声明）。 */
  resolveThinkable(classId: string): ThinkableModule | undefined {
    return this.classes.get(classId)?.thinkable;
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
