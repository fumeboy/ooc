/**
 * OOC Tool 定义（exec/close/wait —— 重构后 3 原语）
 *
 * 旧 open/refine/submit 三件套合并为单一 `exec`；refine/submit 下沉为
 * CommandExecWindow 上注册的命令，与 do_window/talk_window 上的命令同构。
 * 详见 plan: docs/plans/exec-tool-refactor.md
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";

import { CLOSE_TOOL } from "./close.js";
import { EXEC_TOOL } from "./exec.js";
import { WAIT_TOOL } from "./wait.js";

export { CLOSE_TOOL } from "./close.js";
export { EXEC_TOOL } from "./exec.js";
export { MARK_PARAM, TITLE_PARAM } from "./schema.js";
export { WAIT_TOOL } from "./wait.js";

/** 所有 OOC tools（暂不包括 compress） */
export const OOC_TOOLS: LlmTool[] = [EXEC_TOOL, CLOSE_TOOL, WAIT_TOOL];

/**
 * 构建可用 tools 列表
 *
 * 始终返回三个 tool（exec/close/wait），暂不包含 compress。
 */
export function buildAvailableTools(_thread: ThreadContext): LlmTool[] {
  return OOC_TOOLS;
}
