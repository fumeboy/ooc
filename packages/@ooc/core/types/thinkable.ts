/**
 * thinkable 模块契约 —— OocClass 的第五维度槽（agent 类才声明）。
 *
 * 设计权威：`.ooc-world-meta/.../children/thinkable/self.md`。
 *
 * thinkable 描述一个 class 如何把自己组织进 thinkloop 一轮 think：构造 LLM input、折事件、压缩、
 * scheduler tick 钩子。**仅跑 thinkloop 的 thread 类实际注册**——任意 class 可声明，但只有 thread
 * 被调度行使。
 *
 * core thinkable subsystem（scheduler/thinkloop/recovery）经 registry `resolveThinkable(class)`
 * 解析到本模块、调用其字段；core 不具名 import 任何具体 class 的 thinkable 实现。
 */
import type { OocObjectInstance, OocObjectRef } from "../runtime/ooc-class.js";

/**
 * thinkable 维度模块 —— `thinkable/index.ts` 的 default export。
 *
 * 字段全部 optional——class 只实现它关心的钩子，缺省走 core 默认（多半 no-op）。
 * 具体语义见 thread builtin 的 `thinkable/` 实现。
 *
 * **active / refs（issue E）**：协议层声明 class **自我标识自己当下还活不活、还引哪些 object**
 * 两个泛通用谓词，让 core 的 refcount 计算 / GC 兜底 / dispatchUnactive 单一来源化。
 * - `active`：缺省视为 true；返回 false 即"该实例的 data 进入终态、不再可调度"——core GC pass1
 *   据此把它持有的 outgoing refs 一次性 decRef。
 * - `refs`：缺省视为空数组；返回此实例对**其他对象**的引用列表（如 thread 的 contextWindows）。
 *   core 经全 session 扫一次 `inst.refs()` 即可算出任意对象的入度（refcount）。
 *
 * 历史上 refcount/GC 实现在 thread builtin 私域，因为只有 thread 形状对象 contributes refcount；
 * 提升到协议层后该约束变成"实现 refs 的 class contributes"——thread 实现 refs 返 contextWindows，
 * 其它 class 不实现即不贡献，行为等价但归 core 通用。
 */
export interface ThinkableModule<Data = unknown> {
  /**
   * 一轮 think 的入口（thinkloop tick 调一次）。
   *
   * 形参：当前正在跑的 instance 的 data（thinkable 是能力模块、不持 instance handle，
   * 故只收 data 而非 OocObjectInstance）+ class registry 句柄等 cross-cutting deps。
   * 返回：异步完成本轮 think（构造 input → 调 LLM → 执行 tool → 写事件）。
   */
  think?: (data: Data, deps: ThinkableDeps) => Promise<void>;

  /**
   * scheduler 每 tick 给本 class 实例的回调——harvest / child-notify / 唤醒检查等。
   *
   * 调用时机：scheduler 选下个可跑实例前，先调本钩子让 class 维护自己的内部状态。
   */
  onSchedulerTick?: (
    instance: OocObjectInstance<Data>,
    deps: ThinkableDeps,
  ) => void | Promise<void>;

  /**
   * 是否仍处于"活"状态——缺省 true。返回 false → core GC 据此把本实例的 outgoing refs
   * 一次性 decRef（done / failed 终态的实例不应继续引出对象、不应被 scheduler 选中）。
   *
   * 纯函数：基于 data 算，不读外部状态。
   */
  active?: (data: Data) => boolean;

  /**
   * 本实例当前对外持有的引用列表（**别的 object 的 ref**，不含自身）。缺省 []。
   *
   * core 经此算 refcount（"X 的 refs() 含 Y" 视为 X 入度+1 给 Y）；refcount 归 0 即触发
   * `dispatchUnactive(target)`。thread 实现 refs 返 contextWindows。
   *
   * 纯函数：基于 data 算，不读外部状态。
   */
  refs?: (data: Data) => OocObjectRef[];
}

/**
 * thinkable 钩子的依赖句柄 —— core 提供给 class thinkable 实现的能力面。
 *
 * 具体形状由 core 的 thinkable subsystem 注入（llm client / registry / persistable seam ...）。
 * 留 unknown 是为了 contract 层零运行时依赖；实现层各自 cast。
 *
 * **当前 thinkable 模块槽天生面向 thread 系**（OOC 哲学澄清 2：只有 thread 类跑 thinkloop）；
 * 故 `worldDir / onDataEdit / wakeSession` 是 thread 启动 thinkloop 的 cross-cutting opts，
 * 字段全 optional——既有非 thread caller（refs/active）不读这些字段、不破坏向后兼容。
 * thread thinkable adapter 在 think 入口处 fail-loud 断言 worldDir + onDataEdit 必备。
 */
export interface ThinkableDeps {
  /** LLM client（thinkable/llm/client.ts）。 */
  llm: unknown;
  /** class registry 句柄（resolveXxx 用）。 */
  registry: unknown;
  /** 持久化 + flow 寻址用——thread think 与对端调度需。 */
  worldDir?: string;
  /** instance data 变更后通知 runtime 持久化（scope=flow 写入路径）。 */
  onDataEdit?: () => Promise<void> | void;
  /** 跨 thread/跨 session 唤醒钩（issue G）；缺省 no-op + warn 兜底。 */
  wakeSession?: (sessionId: string) => void;
  /**
   * lifecycle on_reload 派发标记表（issue 2026-06-28-lifecycle-module-and-reload）。
   * WorldRuntime 注入；tier-A 控制面 / 测试态可缺省 → ThreadRuntime 静默跳过 on_reload 派发。
   * 类型用 unknown 保 contract 层零运行时依赖（thread 实现 cast 为 ReloadTable）。
   */
  reloadTable?: unknown;
}
