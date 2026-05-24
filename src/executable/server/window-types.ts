/**
 * Object Custom Window 定义形态 —— 由 `stones/<self>/server/index.ts` 的
 * `export const window: ObjectWindowDefinition = { ... }` 提供，对应一个
 * type=`"custom"` 的 ContextWindow（plan §6.2 / §6.5）。
 *
 * 形状要点：
 * - title / description：进 basicKnowledge 与 LLM 视野
 * - renderXml / basicKnowledge / onClose：与 WindowRegistry 同语义，由 custom dispatcher
 *   按 `window.objectId` 路由到这里
 * - commands：标准 CommandTableEntry 字典；commands[name].exec 会在 custom dispatcher
 *   层包一层"把 self: ProgramSelf 注入到 ctx"再执行
 *
 * `ServerMethod` / `LlmMethods` / `ServerMethodContext` 三件套（旧 llm_methods 时代
 * 的概念）已硬切删除（plan D6）。
 */

import type {
  CommandExecutionContext,
  CommandTableEntry,
} from "../windows/_shared/command-types.js";
import type { OnCloseContext, RenderContext } from "../windows/_shared/registry.js";
import type { XmlNode } from "../../thinkable/context/xml.js";
import type { ProgramSelf } from "./types.js";

/** custom window 的 commands[name].exec 收到的 ctx —— 标准 CommandExecutionContext + self。 */
export type CustomCommandContext = CommandExecutionContext & { self: ProgramSelf };

/** Object 在 server/index.ts 里 `export const window` 的形状。 */
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
  /** 该 window 出现时合成的协议知识；可静态字符串或动态函数 */
  basicKnowledge?: string | ((ctx: { self: ProgramSelf }) => string);
  /** close 触发 hook；缺省 = 直接释放 */
  onClose?: (ctx: OnCloseContext) => boolean | void;
  /** Object 自定义命令字典；exec ctx 会被 dispatcher 注入 `self`。 */
  commands?: Record<string, CommandTableEntry>;
}
