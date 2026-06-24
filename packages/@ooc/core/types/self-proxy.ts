/**
 * self-proxy 类型 —— object method / window method / readable 的 `self` 入参形状（纯类型，零依赖）。
 *
 * 对象模型核心 5/6：object 持业务 Data；method 经 `self` 读写它。按维度分流「能做什么」：
 *
 * - **SelfProxy<Data>（读写 + 可调方法）**：给 executable 的 object method（改 data、可副作用）。
 *   `self.data` 读写对象业务数据；`self.methods.foo(args)` 调对象自己的另一条 object method。
 * - **ReadonlySelfProxy<Data>（只读）**：给 executable 以外（window method / readable 投影）。
 *   `self.data` 只读；无 methods（读侧不调副作用方法）。
 *
 * 工厂 `makeSelfProxy` / `makeReadonlySelfProxy` 在 `runtime/self-proxy.ts`（需 RuntimeHandle，
 * 不能放零依赖层）。设计权威：`.ooc-world-meta/.../children/object/self.md`。
 */

/** object method 自调通道：`self.methods.<name>(args)` → 调对象自己的另一条 object method。 */
export type SelfMethods = Record<
  string,
  (args?: Record<string, unknown>) => Promise<string | undefined>
>;

/** executable object method 的 `self`：读写 data + 自调方法。 */
export interface SelfProxy<Data = any> {
  /** 对象自身业务数据（读写；写落在活引用上，经 reportDataEdit 刷盘）。 */
  data: Data;
  /** 调对象自己的另一条 executable object method（exec-by-name 自指）。 */
  methods: SelfMethods;
}

/** executable 以外（window method / readable）的 `self`：只读 data，无方法。 */
export interface ReadonlySelfProxy<Data = any> {
  /** 对象自身业务数据（只读；写抛错）。 */
  data: Readonly<Data>;
}
