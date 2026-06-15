/**
 * persistable 维度契约 —— ooc object 的**自定义序列化**（object-model 核心 7）。
 *
 * 设计权威：`.ooc-world-meta/.../children/class/knowledge/object-model.md`（对象模型单一权威）
 * 接口模板：同目录 `example.md`。本文件是该模板在 core 的**可编译落字**。
 *
 * object 经自定义 persistable 控制自己的**序列化目录与序列化方式**；
 * 未自定义（class 不导出 persistable）则走**系统默认**持久化。
 */

/** persistable save/load 的上下文 —— 定位「这个 object 实例的盘上位置」。 */
export interface PersistableContext {
  /** world 根目录。 */
  baseDir: string;
  /** 对象逻辑 id（含 `_builtin/` 前缀或 world bare id）。 */
  objectId: string;
  /** 运行时 session（flow）id；缺省 = stone（类/身份）层。 */
  sessionId?: string;
  /** 系统已解析好的默认序列化目录（自定义实现可改用别处，但通常基于它）。 */
  dir: string;
}

/** persistable 维度模块 —— `persistable/index.ts` 的 default export。 */
export interface PersistableModule<Data = any> {
  /**
   * 持久化模式（class 自声明，取代旧的 registry `isBuiltinFeature` 标志）。
   * - `"inline"`：实例是所属 thread 的**运行态自有窗**（会话窗等），整窗随该 thread 的
   *   `thread-context.json` **inline 落盘**、不写独立 `state.json`——save/load 由 thread-context
   *   底座代劳，本模块只声明 mode（薄壳）。
   * - 缺省：**独立 object**，写自己的 `state.json`，thread-context 仅存 `_ref` 引用。
   */
  mode?: "inline";
  /** 把实例 Data 写盘（inline 模式由底座代劳、不需要，故可选）。 */
  save?: (ctx: PersistableContext, data: Data) => void | Promise<void>;
  /** 从盘读回实例 Data（无则返回 undefined，走缺省；inline 模式不需要）。 */
  load?: (ctx: PersistableContext) => Data | undefined | Promise<Data | undefined>;
  /**
   * **容器持久化能力**（仅充当 thread 容器的 class 实现，如 `_builtin/agent/thread`）。
   *
   * 背景：thread 是 builtin object——它怎么把自己的会话运行态（thread.json + thread-context.json
   * + inbox + hydrate）落盘/读回是 **thread builtin 自己的逻辑**，不属 core。core 只提供框架
   * （runtime 引擎 / 串行写 / 路径原语 / 默认 state.json IO / registry dispatch）与 API
   * （`writeThread`/`readThread`、manager 的 persist hook）；这些 API 经 registry 解析出本能力并
   * **委托**给 thread builtin，core 不内含 thread 序列化逻辑（object-model 核心 7 + persistable
   * 维度「core=框架+API、builtin=逻辑」边界）。普通 object 不实现本字段。
   */
  container?: ThreadContainerPersistence;
}

/**
 * thread 容器的持久化能力契约——由 thread builtin 实现、core 经 registry dispatch 调用。
 *
 * 这是 core 框架与 thread builtin 逻辑之间的**接缝**：core 的 `writeThread`/`readThread` 薄 API
 * 与 manager 的 persist hook 经此委托，绝不在 core 内含 thread 的序列化形态（thread.json strip
 * 规则、thread-context 的 inline 嵌入 vs `_ref`、inbox、hydrate）。
 */
export interface ThreadContainerPersistence {
  /** 把整个 thread（thread.json + thread-context.json + 各独立子窗 state.json + inbox）落盘。 */
  write(thread: ThreadContextLike): Promise<void>;
  /** 从盘 hydrate 一个 thread（缺省 registry = builtinRegistry）。 */
  read(
    ref: FlowObjectRefLike,
    threadId: string,
    registry: ObjectRegistryLike,
  ): Promise<ThreadContextLike | undefined>;
  /** 把 live 实例 map 的 thread-context 快照落盘（manager `reportContextEdit` 用）。 */
  writeSnapshot(
    thread: ThreadContextLike,
    instances: Map<string, OocObjectInstanceLike>,
    registry: ObjectRegistryLike,
  ): Promise<void>;
}

// 接缝处的类型以「结构占位」import type 引入，避免 contract（最小契约）硬耦合 runtime/thinkable
// 的具体实现模块；实际类型由 thread builtin 与 core dispatch 各自收窄。
import type { ThreadContext as ThreadContextLike } from "../_shared/types/thread.js";
import type { FlowObjectRef as FlowObjectRefLike } from "./common.js";
import type { ObjectRegistry as ObjectRegistryLike } from "../runtime/object-registry.js";
import type { OocObjectInstance as OocObjectInstanceLike } from "../runtime/ooc-class.js";
