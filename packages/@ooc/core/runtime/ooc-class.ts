/**
 * OOC class 装配契约 —— 一个 ooc class `index.ts` 的 `export const Class` 形状，
 * 以及 runtime 持有的「object 实例」。
 *
 * 设计权威：`.ooc-world-meta/.../children/object/self.md`
 * 接口模板：同目录 `example.md`。
 *
 * class = self.md + readable + executable + visible + persistable + types.ts + index.ts
 * （object-model 核心 1）。本文件把后端三维度（executable / readable / persistable）+ 可选
 * constructor 收口成 `OocClass`，由各 class 的 `index.ts` 一处 `export const Class` 装配。
 * （visible 是前端，不在后端路由内。）
 */

import type {
  ExecutableModule,
  ObjectConstructor,
  ObjectLifecycleHook,
  ReadableModule,
  PersistableModule,
  VisibleServerModule,
  ThinkableModule
} from "../types";

/**
 * OOC World 运行时句柄 —— class 的 `init` 在 World 启动时拿到它。
 * 最小占位（机制实现时按需扩展：config / registry / runtime 句柄等）。
 */
export interface World {
  baseDir: string;
}

/**
 * 一个 ooc class 的后端程序路由（`index.ts` 的 `export const Class`）。
 *
 * - construct   : 仅**非单例** class 注册（`exec(ctx, args)` 产出新实例初始 Data）；单例 class 省略
 * - active      : 对象 session refcount 0→1 激活钩子（可选；由 object-lifecycle 在 refcount 0↔1 派发，seam=ThreadRuntime.instantiate）
 * - unactive    : 对象 session refcount 1→0 停用钩子（可选；复用旧 destruct 槽；可返回 {delete:true} 自决删除）
 * - init        : **World 启动时执行**一次的 class 级初始化 `(world) => err`（返回错误信息，空=成功）；
 *                 用于起后台通道/长连接等（如 feishu_app 起 lark event relay）。机制（World 启动时
 *                 遍历调 init）待实现。
 * - executable  : object method（改数据 / 副作用；LLM 在 thinkloop 行使）
 * - readable    : 投影成 context window + window method
 * - persistable : 自定义序列化（省略走系统默认）
 * - thinkable   : 一个 class 如何把自己组织进 thinkloop 的一轮 think（buildInputItems / appendEvents /
 *                 compress 钩子 / onSchedulerTick）；core thinkloop/scheduler 经 registry 解析后调用。
 *                 **仅跑 thinkloop 的 thread 类实际注册**——任意 class 可声明，但只有 thread 被调度行使。
 * - visible : 面向前端的服务端 API（HTTP 控制面编辑 object data；无 thinkloop thread）
 *
 * **OOC 协议层不内建任何继承 / dispatch chain 机制**（object 模型核心 2）：ClassRegistry 注册扁平的
 * class 定义，无 chain 元信息、无沿链 fallback。class 想复用另一个 class 的能力，由其 `index.ts` 用
 * TS 标准 `import` + 对象 `spread`（或 method 级 import 函数 + 显式调）在源码侧完成。
 *
 * 注：constructor 槽位命名为 **`construct`** 而非 `constructor` —— JS `Object.prototype.constructor`
 * 会遮蔽该键（`({}).constructor === Object` 恒真 → 单例无法被识别；TS 也会拿 `Function` 去比对类型而报错）。
 * example.md 示例里写的 `constructor:` 是该陷阱下的笔误，落地契约统一用 `construct`。
 */
export interface OocClass<Data = any, Win = any> {
  id: string;
  construct?: ObjectConstructor<Data>;
  active?: ObjectLifecycleHook; // refcount 0→1 派发（object-lifecycle dispatchActiveIfFirst，seam=ThreadRuntime.instantiate）
  unactive?: ObjectLifecycleHook;
  init?: (world: World) => string | Promise<string>;
  executable?: ExecutableModule<Data>;
  readable?: ReadableModule<Data, Win>;
  persistable?: PersistableModule<Data>;
  visible?: VisibleServerModule<Data>;
  /** thinkable 维度模块 —— 仅跑 thinkloop 的 class（thread）实际注册;其它 class 缺省。 */
  thinkable?: ThinkableModule<Data>;
  /**
   * 版本化字段列表（issue C）—— 同伴常量方案 B：每个 builtin 在 `types.ts` 旁导出
   * `VERSIONED_FIELDS`，`index.ts` 装配时引用注入。
   *
   * 列出的字段是 class definition 的一部分（与 executable/readable 同级）：runtime save
   * 按 VERSIONED_FIELDS 字段级路由——版本化字段经 super flow 内的 reflect method 走 PR 合入 stone
   * canonical；其余字段（unversioned）由 method 写在 flow 暂存内，session 结束（或显式
   * `talk(super)`）由 reflect method 链路合入 pool / 持久化语义层。method 路径**不**直接写 stone/pool。
   *
   * 缺省 `[]`（全部字段非版本化）。VERSIONED_FIELDS 本身不可在 flow 内 mutate——改它即
   * "改 class 源码"，走 PR。
   */
  versioned_fields?: readonly string[];
}


/**
 * `package.json` 的 `ooc` 元信息（object-model 细节补充）。
 * - kind  : 这份 stone 是 class（定义）还是 object（实例）
 * - class : object 经 ooc.class 单跳 binding 一个 class 作为身份模板。OOC 协议层不感知"父子关系"
 *           —— class 间的复用一律由 class 源码用 import + spread 自行表达，runtime 不解析继承链。
 */
export interface OocPackageMeta {
  objectId: string;
  kind: "class" | "object";
  class?: string;
}

export interface OocObjectInstance<Data = unknown> {
  id: string;
  class: string;
  data: Data;
}

export type ContextWindow = OocObjectRef;
/**
 * OocObjectRef —— context window 的引用形态。
 *
 * 字段语义：
 * - `id`          : 对象实例 id（OocObjectInstance.id）—— refcount / session 表查询主键。
 * - `class`       : 对象 class id（如 `_builtin/agent/thread`）—— **对象身份**,不可在 method 内变。
 * - `window_view` : 该窗的投影**视角**（如 `default` / `self` / `super`）。**不参与对象身份**——
 *                   同 (id, class) 的两个 ref 可持不同 window_view（视角投影,如 caller/callee 同看
 *                   一条 thread）。runtime-owned:agent 自写 method 应只读、不应自改提权视角。
 *                   缺省 → readable render 走 DEFAULT_WINDOW_VIEW（"default"）兜底。
 * - `title`       : 人读标题（前端 / LLM xml 渲染用）。
 * - `createdAt`   : ref 建立时间戳。
 * - `data`        : 该窗当前的**投影态 Win**（window method 返回的形态）—— 不是业务 data,业务 data
 *                   活在 OocObjectInstance.data 上、按 ref.id 经 session 表解析。
 * - `closable`    : 是否允许 close 原语关闭（结构窗 = false,如 thread self-view ref / 工具窗）。
 *
 * 身份比较使用 `refIdentity` helper（core/types/context-window.ts）剥离 window_view 等渲染 hint。
 */
export interface OocObjectRef<WinData = unknown> {
  id: string;
  class: string;
  window_view?: string;
  title?: string;
  createdAt: number;
  data?: WinData;
  closable?: boolean;
}
