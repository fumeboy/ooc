/**
 * extendable/lark — 飞书集成的 lark-cli 适配层。
 *
 * 本目录持有 OOC 与 lark-cli 子进程之间的全部桥接代码：
 * - cli.ts          larkExec 子进程 helper（OOC 唯一访问飞书 OAPI 的通道）
 * - feishu-chat/    群聊 / 单聊 ContextWindow 类型 + 注册 + root opener method
 * - feishu-doc/     文档 ContextWindow 类型 + 注册 + root opener method
 *
 * 与 OOC core 的关系：
 * - feishu_chat / feishu_doc 仍然是一等 ObjectType（声明在 src/executable/windows/_shared/types.ts），
 *   本目录只提供它们的实现 + 注册逻辑。
 * - 注册通过 src/executable/windows/_shared/registry.ts:registerObjectType 完成；
 *   本 barrel 的 side-effect import 触发注册，由 src/extendable/index.ts 进一步被 windows barrel 拉起。
 *
 * 设计依据见 meta/case.feishu-integration.doc.ts。
 */

import "./feishu-chat/index.js";
import "./feishu-doc/index.js";

export { larkExec, larkCheckAuth, LarkCliError } from "./cli.js";
export type { LarkExecOptions, LarkExecResult } from "./cli.js";

export { openFeishuChatMethod } from "./feishu-chat/open-method.js";
export { openFeishuDocMethod } from "./feishu-doc/open-method.js";

export { startLarkEventRelay, maybeForwardToLark } from "./event-relay/index.js";
