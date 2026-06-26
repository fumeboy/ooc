/**
 * persistable save/load 的上下文 —— 定位「这个 object 实例的盘上位置」+ 写哪一层。
 *
 * `scope` 字段（issue C 引入）显式标记本次 save/load 写哪一层：
 *   - "flow"  ：本 session 暂存（默认；method 路径恒为 flow）。
 *   - "stone" ：版本化字段的 canonical 落点（仅 super flow 内的 reflect method 后续以此 scope 调用，issue D 主体）。
 *   - "pool"  ：sediment-only 路径（knowledge 等；普通 object data 不走 pool）。
 *
 * 三层物理布局裁决参见 `.ooc-world-meta/.../children/persistable/self.md` 核心 1-N。
 */
export type PersistableScope = "stone" | "pool" | "flow";

export interface PersistableContext {
  /** world 根目录。 */
  baseDir: string;
  /** 对象逻辑 id（含 `_builtin/` 前缀或 world bare id）。 */
  objectId: string;
  /** 运行时 session（flow）id；缺省 = stone（类/身份）层。 */
  sessionId?: string;
  /** 系统已解析好的默认序列化目录（自定义实现可改用别处，但通常基于它）。 */
  dir: string;
  /**
   * 本次 save/load 写哪一层（issue C 引入）。
   *
   * - method 路径调用 save 时 runtime 注入 "flow"（保留向后兼容：旧 save 实现可忽略此字段，
   *   作为 "flow" 默认行为，与 method 写一律落 flow 暂存的契约一致）。
   * - reflectable 反思链路以 scope="stone"/"pool" 重调 save（issue D 主体）；本 issue 仅实现
   *   兼容入口，core runtime 不主动以 stone/pool scope 调用。
   */
  scope: PersistableScope;
}

/** persistable 维度模块 —— `persistable/index.ts` 的 default export。 */
export interface PersistableModule<Data = any> {
  /** 把实例 Data 写盘（inline 模式由底座代劳、不需要，故可选）。 */
  save?: (ctx: PersistableContext, data: Data) => void | Promise<void>;
  /** 从盘读回实例 Data（无则返回 undefined，走缺省；inline 模式不需要）。 */
  load?: (ctx: PersistableContext) => Data | undefined | Promise<Data | undefined>;
}
