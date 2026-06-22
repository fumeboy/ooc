/**
 * persistable 维度契约 —— ooc object 的**自定义序列化**（object-model 核心 7）。
 *
 * 设计权威：`.ooc-world-meta/.../children/object/self.md`（对象模型单一权威）
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
   *   `thread-context.json` **inline 落盘**、不单独落 `data.json`——save/load 由 thread-context
   *   底座代劳，本模块只声明 mode（薄壳）。
   * - 缺省：**独立 object**，写自己的 `data.json`（裸 Data），thread-context 仅存 `_ref` 引用。
   */
  mode?: "inline";
  /** 把实例 Data 写盘（inline 模式由底座代劳、不需要，故可选）。 */
  save?: (ctx: PersistableContext, data: Data) => void | Promise<void>;
  /** 从盘读回实例 Data（无则返回 undefined，走缺省；inline 模式不需要）。 */
  load?: (ctx: PersistableContext) => Data | undefined | Promise<Data | undefined>;
}

// 注：thread 容器持久化（thread.json + thread-context.json + inbox + hydrate）现在就是 thread
// builtin 的标准 `save`/`load`（`thread/persistable`）。其落盘 API `writeThread`/`readThread` 也在
// thread builtin（`@ooc/builtins/agent/thread/persistable/thread-json`）——core 不再有 registry-dispatch
// 壳或专属 `container` 契约；runtime 引擎直接 import 本 builtin 的 API。
