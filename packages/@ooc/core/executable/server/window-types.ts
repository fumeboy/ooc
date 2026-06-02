/**
 * Object Window 定义形态 —— 由 `stones/<self>/server/index.ts` 的
 * `export const window: ObjectWindowDefinition = { ... }` 提供，对应一个
 * type=objectId 的 ContextWindow（2026-06-01 ooc-6 Object Unification）。
 *
 * 新设计：
 * - window.id = objectId（不再经过 custom: 前缀包装）
 * - window.type = objectId（每个 object 注册自己的 type）
 * - 不再有 custom window wrapper；所有 object 直接实现 window 接口
 *
 * 形状要点：
 * - title / description：进 basicKnowledge 与 LLM 视野
 * - renderXml / basicKnowledge / onClose：与 WindowRegistry 同语义，由 registry
 *   按 `window.type` 路由到这里
 * - commands：标准 CommandTableEntry 字典；commands[name].exec 会在 dispatcher
 *   层包一层"把 self: ProgramSelf 注入到 ctx"再执行
 *
 * `ServerMethod` / `LlmMethods` / `ServerMethodContext` 三件套（旧 llm_methods 时代
 * 的概念）已硬切删除（plan D6）。
 */

import type {
  CommandExecutionContext,
  CommandTableEntry,
  ObjectMethod,
} from "../windows/_shared/command-types.js";
import type { OnCloseContext, ReadableFn, RenderContext } from "../windows/_shared/registry.js";
import type { XmlNode } from "../../thinkable/context/xml.js";
import type { ProgramSelf } from "./types.js";

/**
 * Object window 的 commands[name].exec 收到的 ctx —— 标准 MethodExecutionContext + programSelf。
 *
 * 2026-06-02 P6.§1 命名修正：原字段名 `self: ProgramSelf` 与
 * `MethodExecutionContext.self: ContextWindow`（method 的 receiver，OOP 语义）冲突。
 * 两个 `self` 是**不同概念**：
 *   - `MethodExecutionContext.self`：method 被调用的 ContextWindow（receiver）
 *   - `CustomCommandContext.programSelf`：Program object 的类型化自我数据（由 stone hydrator 注入）
 * 为消歧，把 Program 维度的 self 改名为 `programSelf`；`self` 字段沿用 receiver 语义。
 *
 * 旧 stone 代码若仍写 `ctx.self.dir` 等 ProgramSelf 访问，应迁移为 `ctx.programSelf.*`。
 * 由于 `self` 已被 receiver 占用，`programSelf` 不再以 `self` 作 alias——TS 编译会指出迁移点。
 */
export interface CustomCommandContext extends CommandExecutionContext {
  /** P6.§1: Program object 的自我数据（dir / callCommand / getData / setData / getThreadLocal / setThreadLocal）。 */
  programSelf: ProgramSelf;
}

/** Object 在 server/index.ts 里 `export const window` 的形状（2026-05-28 ooc-6 更新）。 */
export interface ObjectWindowDefinition {
  /** 出现在 context 里的标题 */
  title?: string;
  /** 一行说明，会进 basicKnowledge */
  description?: string;
  /**
   * 渲染该 window 内层子节点（同 WindowRegistry.renderXml）；
   * 返回 `XmlNode[]`——即 `<window ...>` 包裹的 children 序列。
   */
  renderXml?: (ctx: RenderContext) => XmlNode[] | Promise<XmlNode[]>;
  /**
   * 动态上下文渲染函数（2026-05-28 ooc-6 新增，对应 readable.ts）；
   * 优先级高于 renderXml 和 readable.md。
   */
  readable?: ReadableFn;
  /** 该 window 出现时合成的协议知识；可静态字符串或动态函数。
   *  ctx 提供 `programSelf`（Program 维度的 ProgramSelf；2026-06-02 P6.§1 从 `self` 改名）。 */
  basicKnowledge?: string | ((ctx: { programSelf: ProgramSelf }) => string);
  /** close 触发 hook；缺省 = 直接释放 */
  onClose?: (ctx: OnCloseContext) => boolean | void;
  /**
   * 原型 object id（2026-05-28 ooc-6 新增）；
   * 继承原型的 methods / UI / readable。
   */
  prototype?: string;
  /** Object 自定义命令字典（2026-05-28 更新为 ObjectMethod，支持 public/for_ui_access）。 */
  commands?: Record<string, ObjectMethod>;
  /**
   * Alias for commands（2026-05-28 ooc-6 过渡期间支持 `methods` 作为 `commands` 别名）。
   * 某些已迁移 stones 使用 methods 字段；加载时会合并到 commands。
   */
  methods?: Record<string, ObjectMethod>;
}
