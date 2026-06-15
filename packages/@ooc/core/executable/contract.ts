/**
 * executable 维度契约 —— ooc class 的 **object method** 接口。
 *
 * 设计权威：`.ooc-world-meta/.../children/class/knowledge/object-model.md`（对象模型单一权威）
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
 * - permission  : 三档准入（allow 默认 / ask 触发 HITL / deny 拒绝）
 * - for_ui_access: 是否可经前端 HTTP API（visible UI）请求（见 object-model 核心 6）
 * - public      : 是否对 peer object 可见可调
 * - for_reflectable: 是否仅在 super flow（反思 session）下 surface
 * - exec        : (ctx, self, args) → 结果文本（或 undefined）；**可改 self、可副作用**
 */
export interface ObjectMethod<Data = any, Args = any> {
  name: string;
  description: string;
  schema?: MethodCallSchema;
  permission?: (args: Record<string, unknown>) => "allow" | "ask" | "deny";
  for_ui_access?: boolean;
  public?: boolean;
  for_reflectable?: boolean;
  exec: (
    ctx: ExecutableContext,
    self: Data,
    args: Args,
  ) => string | undefined | Promise<string | undefined>;
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

/** executable 维度模块 —— `executable/index.ts` 的 default export。 */
export interface ExecutableModule<Data = any> {
  methods: ObjectMethod<Data>[];
}
