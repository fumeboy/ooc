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
  /** 把实例 Data 写盘（inline 模式由底座代劳、不需要，故可选）。 */
  save?: (ctx: PersistableContext, data: Data) => void | Promise<void>;
  /** 从盘读回实例 Data（无则返回 undefined，走缺省；inline 模式不需要）。 */
  load?: (ctx: PersistableContext) => Data | undefined | Promise<Data | undefined>;
}
