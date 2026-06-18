/**
 * executable 维度契约 —— ooc class 的 **object method** 接口。
 *
 * 设计权威：`.ooc-world-meta/.../children/object/self.md`（对象模型单一权威）
 * 接口模板：同目录 `example.md`。本文件是该模板在 core 的**可编译落字**。
 *
 * object method **可改 object data、可产生副作用**（区别于 readable 维度的 window method，
 * 后者只动展示投影态、不碰业务数据）。统一签名 `(ctx, self, args)`：
 *   - ctx  : ExecutableContext —— 运行时环境（thread / 对象身份信封 / runtime 句柄）
 *   - self : Data —— 对象自身**业务数据**（由该 class 的 `types.ts` 定义；方法直接读写其字段）
 *   - args : 调用参数
 *
 * 与旧契约（`_shared/method-types.ts` 的 `ObjectMethod` + 单参 `MethodExecutionContext`
 * 把 `ctx.self`=整窗、`ctx.args` 捆绑在 ctx）的差异：self / args 升为独立入参，self 收窄为纯 Data。
 */

import type {
  ThreadContext,
  FlowObjectRef,
  ThreadPersistenceRef,
} from "../_shared/types/thread.js";
import type { MethodCallSchema } from "../_shared/types/intent.js";

/**
 * runtime 句柄 —— 让 method / constructor 行使「需要 runtime 协助」的副作用。
 *
 * 最小面：实例化子对象（委托类 tool-object 如 filesystem.grep → 实例化 search）、关窗。
 * 具体实现由 core 反推阶段提供（runtime/WindowManager）；零依赖契约层只声明面。
 */
export interface RuntimeHandle {
  /** 调某 class 的 constructor 造新对象、挂进当前 thread；返回新对象 id。 */
  instantiate(classId: string, args?: Record<string, unknown>): Promise<string>;
  /** 关闭/卸载一个对象（窗）。 */
  close?(objectId: string): void | Promise<void>;
  /**
   * 委托调当前 thread 内某 object 的 **object method**（解析目标 object 的 class →
   * resolveObjectMethod → 三参 exec）。用于一个 method 内编排别的对象的 method
   * （如 interpreter_process 的 `self.callMethod` 跨窗调用）。
   * 找不到 object / method 时抛清晰错误；返回该 method 的结果文本（或 undefined）。
   */
  callMethod?(
    objectId: string,
    methodName: string,
    args?: Record<string, unknown>,
  ): Promise<string | undefined>;
  /**
   * 经一个会话窗（talk-like：creator / peer / fork）把一段消息派给对端。
   *
   * 最小通道：复用 talk object method `say`——`windowId` 指向当前 thread 内某 talk-like
   * 窗实例（典型为 creator 会话窗），`msg` 为消息正文。peer 走磁盘 talk-delivery、
   * fork 走内存树派送由该窗自身 TalkData 分流。用于 agent.end 把 result 经 creator 窗回报。
   * 找不到窗 / 该窗 class 无 say 时抛清晰错误。
   */
  say?(windowId: string, msg: string): Promise<string | undefined>;
}

/**
 * object method 的执行上下文。
 *
 * **不含** self / args —— 它们是 exec 的独立入参。ctx 只携带「方法做副作用时需要的运行时环境」。
 */
export interface ExecutableContext {
  /** 当前执行该 method 的 thread（method 跑在某 thread 的 thinkloop 内时存在）。 */
  thread?: ThreadContext;
  /** 接收者对象的身份信封（id / class）。业务数据经 self 入参，**不**在此。 */
  object: { id: string; class: string };
  /** runtime 句柄 —— 实例化子对象 / 关窗等需 runtime 协助的副作用。 */
  runtime?: RuntimeHandle;
  /** method 跑在独立 flow object 上时设置。 */
  ownerFlowObjectRef?: FlowObjectRef;
  /** method 跑在持久化 thread 中时设置。 */
  ownerThreadRef?: ThreadPersistenceRef;
  /** 通知 runtime：本 method 改了 object data / context，需重新持久化。 */
  reportDataEdit?: () => Promise<void>;
  reportContextEdit?: () => Promise<void>;
  /** 调用参数副本（与 exec 的 args 入参同源；onFormChange 等无 args 入参的场景从此取）。 */
  args: Record<string, unknown>;
}

/**
 * constructor 的执行上下文 —— 实例尚未存在，故**无 `object`**（id/class 由 runtime 在包信封时分配）。
 * trivial 的 class（如 note/example）忽略 ctx；需要 thread/worktree/spawn 等前置的 class（file/search/
 * *_process）从此取运行时环境。
 */
export interface ConstructorContext {
  thread?: ThreadContext;
  runtime?: RuntimeHandle;
  ownerFlowObjectRef?: FlowObjectRef;
  ownerThreadRef?: ThreadPersistenceRef;
  args: Record<string, unknown>;
}

/**
 * object method 定义。
 *
 * - name        : 方法名（dispatch 入口；同 class 内 object/window method 不可重名）
 * - description : LLM 面向的方法描述（必填）
 * - schema      : 可选参数 schema（结构化渲染 + fail-soft 校验）
 * - for_ui_access: 是否可经前端 HTTP API（visible UI）请求（见 object-model 核心 6）
 * - public      : 是否对 peer object 可见可调
 * - for_reflectable: 是否仅在 super flow（反思 session）下 surface
 * - exec        : (ctx, self, args) → 结果（`ObjectMethodResult`{message?/data?/err?}，或裸 string = sugar for {message}，或 void/undefined）；**可改 self、可副作用**
 */
export interface ObjectMethod<Data = any, Args = any> {
  name: string;
  description: string;
  schema?: MethodCallSchema;
  for_ui_access?: boolean;
  public?: boolean;
  for_reflectable?: boolean;
  /** 权限谓词：调用前按 args 算 `allow` / `ask` / `deny`（缺省 allow）；判定归 observable 的 permission 模型。 */
  permission?: (args: Record<string, unknown>) => "allow" | "ask" | "deny";

  intents?: {name: string, description: string}[]
  route?: (ctx: ExecutableContext, self: Data, args: Args) => ObjectMethodIntents;
  exec: (
    ctx: ExecutableContext,
    self: Data,
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
  err?: string
}

/**
 * 把 method exec 的返回形态规范化为 `ObjectMethodResult`（method 的统一结果形状）。
 *
 * exec 三态返回（`ObjectMethodResult | string | void`）由 runtime（WindowManager）/ HTTP `call_method`
 * 经此收口为**单一 result 形状**——method outcome 即 method result，不再有独立的 outcome 信封类型：
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
 * `exec(ctx, args)` 产出**新实例的初始 Data**（不是窗；runtime 据此把 Data 包成对象信封）。
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
 * 对象 **destructor**（与 construct 对应）—— 对象销毁/卸载时的清理逻辑。
 *
 * `exec(ctx, self)` 在对象被销毁前执行清理（释放进程 / 关连接 / 级联归档 children…）；
 * 与 construct 镜像：construct 产出初始 Data、destruct 消费末态 self 做收尾。
 *
 * 注：**暂仅接口定义**——runtime 何时调用 destruct（close 原语 / world 关停 / GC）的机制待实现。
 */
export interface ObjectDestructor<Data = any> {
  description: string;
  exec: (ctx: ConstructorContext, self: Data) => void | Promise<void>;
}

/** executable 维度模块 —— `executable/index.ts` 的 default export。 */
export interface ExecutableModule<Data = any> {
  methods: ObjectMethod<Data>[];
}
