import type { MethodCallSchema } from "./intent.js";
import type { SelfProxy } from "./self-proxy.js";
import type { OocObjectRef } from "../runtime/ooc-class.js";

/**
 * runtime 句柄 —— 让 method / constructor 行使「需要 runtime 协助」的副作用。
 *
 * 最小面：实例化子对象（委托类 tool-object 如 filesystem.grep → 实例化 search）、关窗。
 * 具体实现由 core 反推阶段提供（runtime/ThreadRuntime）；零依赖契约层只声明面。
 */
export interface RuntimeHandle {
  /** 调某 class 的 constructor 造新对象、挂进当前 thread；返回新对象 id。 */
  instantiate(_:{class: string, childId?: string, args?: Record<string, unknown>}): Promise<OocObjectRef>;
  /**
   * 委托调当前 thread 内某 object 的 **object method**（解析目标 object 的 class →
   * resolveObjectMethod → 三参 exec）。用于一个 method 内编排别的对象的 method
   * （如 interpreter_process 的 sandbox 经 `ctx.runtime.callMethod` 跨窗调用）。
   * 找不到 object / method 时抛清晰错误；返回该 method 的结果文本（或 undefined）。
   */
  callMethod?(
    objectId: string,
    methodName: string,
    args?: Record<string, unknown>,
  ): Promise<string | undefined>;

  /**
   * 对目标 object 的某 method 跑一次 `route`（填表式渐进执行的意图/提示重算）——解析目标 class 的
   * method，若声明了 route 则用目标对象 data + 给定 args 求值返回 `ObjectMethodIntents`；无 route /
   * 找不到目标则返回 undefined。method_exec form 的 refine 用它在累积参数后刷新 tip / intents。
   * 与 callMethod 区别：runRoute 只算意图不执行 exec、不产副作用。
   */
  runRoute?(
    targetObjectId: string,
    methodName: string,
    args: Record<string, unknown>,
  ): Promise<ObjectMethodIntents | undefined>;
}

/**
 * object method 的执行上下文。
 *
 * **不含** self / args —— 它们是 exec 的独立入参。ctx 只携带「方法做副作用时需要的运行时环境」。
 */
export interface ExecutableContext {
  /** 接收者对象的身份元信息（id / class）。业务数据经 self 入参，**不**在此。 */
  object: { id: string; class: string };
  /** runtime 句柄 —— 实例化子对象 / 关窗等需 runtime 协助的副作用。 */
  runtime: RuntimeHandle;
  /** 通知 runtime：本 method 改了 object data，需重新持久化。 */
  reportDataEdit: () => Promise<void>;
  /** 调用参数副本（与 exec 的 args 入参同源；onFormChange 等无 args 入参的场景从此取）。 */
  args: Record<string, unknown>;

  dir: string;
  worldDir: string;
  sessionId: string;
}

/**
 * constructor 的执行上下文 —— 实例尚未存在，故**无 `object`**（id/class 由 runtime 在打包成实例时分配）。
 * trivial 的 class（如 note/example）忽略 ctx；需要 persistence/worktree/spawn 等前置的 class（file/search/
 * *_process）从此取运行时环境。
 */
export interface ConstructorContext {
  sessionId: string;
  worldDir: string;
  /** 该新实例的默认持久化目录（runtime 已据 sessionId+objectId 派生）；可写副作用前置文件落此。 */
  dir: string;
  runtime?: RuntimeHandle;
  args: Record<string, unknown>;
}

/**
 * object method 定义。
 *
 * - name        : 方法名（dispatch 入口；同 class 内 object/window method 不可重名）
 * - description : LLM 面向的方法描述（必填）
 * - schema      : 可选参数 schema（结构化渲染 + fail-soft 校验）
 * - public      : 是否对 peer object 可见可调
 * - exec        : (ctx, self, args) → 结果（`ObjectMethodResult`{message?/data?/err?}，或裸 string = sugar for {message}，或 void/undefined）；**可改 self、可副作用**
 */
export interface ObjectMethod<Data = any, Args = any> {
  name: string;
  description: string;
  schema?: MethodCallSchema;
  public?: boolean;
  /** 权限谓词：调用前按 args 算 `allow` / `ask` / `deny`（缺省 allow）；判定归 observable 的 permission 模型。 */
  permission?: (args: Record<string, unknown>) => "allow" | "ask" | "deny";
  intents?: {name: string, description: string}[]
  route?: (ctx: ExecutableContext, self: SelfProxy<Data>, args: Args) => ObjectMethodIntents;
  exec: (
    ctx: ExecutableContext,
    self: SelfProxy<Data>,
    args: Args,
  ) => ObjectMethodResult | string | void | Promise<ObjectMethodResult | string | void>;
}

// ObjectMethodIntents
// 类似于现实中我们填写的电子表单
// 要提交行动前，发起一个表单
// 填几个参数，然后给出新的填表项并给出提示，然后继续填，然后继续提示，直到表单填写完毕再提交
// OOC 系统的 Object Method 也支持这个模式，如果 Object Method 定义了 route，那么方法执行时，会先执行 route 取得意图
// 同时在 上下文中，会创建一个 ObjectMethodForm window, 用于显示表单，这个 window 具有 refine 方法用于继续填充调整参数，具有 submit 方法用于提交表单
// route 计算出的 tip 会作为 tool call 结果返回，计算出的 intents 会用于激活关联的知识
export interface ObjectMethodIntents {
  tip?: string,
  intents?: string[] // 从 args 推导的行为意图
  quickSubmit?: boolean // 无需再主动对表单执行 submit 方法，立刻执行
}

export interface ObjectMethodResult {
  message?: string;
  data?: any;
  err?: string;
  /** method 执行产出的 object 引用（context window）——runtime 据此把新对象挂进当前 thread。 */
  refs?: OocObjectRef[];
}

/**
 * 把 method exec 的返回形态规范化为 `ObjectMethodResult`（method 的统一结果形状）。
 *
 * exec 三态返回（`ObjectMethodResult | string | void`）由 runtime（ThreadRuntime）/ HTTP `call_method`
 * 经此收口为**单一 result 形状**——method outcome 即 method result，不再有独立的 outcome 包装类型：
 * - void / undefined → `{}`
 * - 裸 string（sugar）→ `{ message }`
 * - 已是 `ObjectMethodResult` → 原样
 */
export function normalizeMethodResult(
  raw: ObjectMethodResult | string | void,
): ObjectMethodResult {
  if (typeof raw === "string") return { message: raw };
  if (raw && typeof raw === "object") return raw;
  return {};
}

/**
 * 非单例 class 的 **constructor**（object-model 核心 3）。
 *
 * `exec(ctx, args)` 产出**新实例的初始 Data**（不是窗；runtime 据此把 Data 包成对象实例）。
 * 构造前置的副作用（写盘 / worktree / spawn 进程 / 校验存在性…）在 exec 体内经 ctx 行使；
 * 失败 throw（runtime 捕获、不建窗）。单例 class 无 constructor —— 其唯一规范实例的数据来自
 * persistable / self.md / 缺省空。
 */
export interface ObjectConstructor<Data = any, Args = any> {
  description: string;
  schema?: MethodCallSchema;
  exec: (ctx: ConstructorContext, args: Args) => Data | Promise<Data>;
}

/**
 * 对象生命周期钩子的执行上下文 —— 在 construct 上下文之上携带 refcount 变动的目标 id。
 *
 * 生命周期钩子作用于**既有**对象（不产 Data）；body 经 ctx 自解析它要操作的对象：
 * `targetId` 是 refcount 跨 0↔1 的对象 id。
 */
export interface LifecycleContext extends ConstructorContext {
  /** refcount 跨 0↔1 的对象 id（钩子 body 据此定位自己要操作的对象）。 */
  targetId: string;
  reportDataEdit: () => Promise<void>;
}

/** unactive 返回值：delete:true → core 把 object 彻底从 session 移除（含持久化文件）；缺省=只停用。 */
export interface UnactiveResult {
  delete?: boolean;
}

/**
 * 对象生命周期钩子（active/unactive 共用）—— 与 construct 对称、按 refcount 0↔1 触发。
 * 作用于**既有**对象（不产 Data）；`self` = refcount 跨界的**目标对象的业务 data**（由 runtime 解析
 * `ctx.targetId` 注入），body 直接操作 `self`、不必从 ctx 自解析目标。无目标 data 时 `self` 为 undefined。
 * 皆可选。无独立 destruct —— OOC object 默认持久身份；unactive 可经返回 {delete:true} 自决彻底删除
 * （refcount-0-gated，故无悬空引用）。仅 unactive 路径 honor delete；active 返回值忽略。
 */
export interface ObjectLifecycleHook<Data = any> {
  description: string;
  exec: (
    ctx: LifecycleContext,
    self: Data,
  ) => void | UnactiveResult | Promise<void | UnactiveResult>;
}

/** executable 维度模块 —— `executable/index.ts` 的 default export。 */
export interface ExecutableModule<Data = any> {
  methods: ObjectMethod<Data>[];
}
