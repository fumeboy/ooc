/**
 * method_exec_form —— 填表式渐进执行的 form data。
 *
 * 服务于 `ObjectGuideMethod` 多步引导触发（dispatch 命中 guide 且 `quickSubmit` 非 true 时 runtime
 * 自动实例化）：agent 经 `refine` 累积 args + 重跑 guide.route 刷新 tip/intents，最后 `submit` 真 exec。
 *
 * **历史**：本 form 原绑定 `ObjectMethod.route`（method 既单步也多步），issue
 * 2026-06-26-object-guide-method-split 将多步语义拆到独立的 `ObjectGuideMethod`，form 现仅服务于 guide。
 * 数据字段亦相应改名 `targetMethod` → `guideName`、`tip/intents` → `currentTip/currentIntents`。
 *
 * **issue E** 新增 `want?: string`：`open` 原语开 form 时把 agent 的自然语言意图写进 form 上下文，
 * 让 agent 在 refine / submit 前能看到自己当初为什么开这张表，对齐"开 form = 显式表达 want"语义。
 */
export interface Data {
  /** 目标 object id（guide 所属对象）。 */
  targetObjectId: string;
  /**
   * 目标 object 的 class id（**issue N** 新增）。form 持此字段让 `readable.intents` 产
   * `intent::form_open::<targetClass>::<guideName>` 不再需要二次反查 registry——core
   * `scanIntents` 只依赖 readable 槽 + self,不识别 class id。caller（thread-runtime / open / refine
   * route 自动开 form 时）由 `ref.class` 直填。
   */
  targetClass: string;
  /** 目标 **guide** 名（dispatch 时 LLM 调用的 guide method name；open 单步 method 时填 method name）。 */
  guideName: string;
  /** 累积参数（多轮 refine merge）。 */
  accumulatedArgs: Record<string, unknown>;
  /** 最近一次 route 计算出的 tip（人读提示，渲进 readable 投影）。 */
  currentTip?: string;
  /** 最近一次 route 计算出的 intents（驱动知识激活；activator 按 form objectId 作 source-key 注入）。 */
  currentIntents?: string[];
  /**
   * agent 在 `open` 原语调用时写下的自然语言意图——"我为什么想调这个 method"。
   * 仅 open 路径注入（exec 命中 guide 自动开 form 时不带 want）；渲入 readable 让 agent 下一轮可见。
   */
  want?: string;
  /** 最近一次 submit 失败的错误（用于 form 复活 + agent 自纠）。 */
  lastError?: string;
  createdAt: number;
}

/**
 * 版本化字段列表（issue C 同伴常量方案 B）。
 *
 * 本 class 全部字段非版本化（运行时载体 / tool-object / sediment 已落 pool）。
 */
export const VERSIONED_FIELDS: readonly (keyof Data)[] = [] as const;
