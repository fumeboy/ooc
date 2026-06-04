/**
 * OOC Tool 定义（exec/close/wait —— 重构后 3 原语）
 *
 * 旧 open/refine/submit 三件套合并为单一 `exec`；refine/submit 下沉为
 * MethodExecWindow 上注册的命令，与 do_window/talk_window 上的命令同构。
 * 详见 plan: docs/plans/exec-tool-refactor.md
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";

import { CLOSE_TOOL } from "./close.js";
import { COMPRESS_TOOL } from "./compress.js";
import { EXEC_TOOL } from "./exec.js";
import { WAIT_TOOL } from "./wait.js";

export { CLOSE_TOOL } from "./close.js";
export { COMPRESS_TOOL } from "./compress.js";
export { EXEC_TOOL } from "./exec.js";
export { MARK_PARAM, TITLE_PARAM } from "./schema.js";
export { WAIT_TOOL } from "./wait.js";

/**
 * 所有 OOC tools (P0b 起 compress 进入正式 tool 集合)。
 *
 * compress 本 phase 仅支持 scope="windows";events / auto 抛 not-implemented,
 * 仍把 tool 暴露给 LLM 以便其在折叠态体验链路上协作。
 */
export const OOC_TOOLS: LlmTool[] = [EXEC_TOOL, CLOSE_TOOL, WAIT_TOOL, COMPRESS_TOOL];

/**
 * 构建可用 tools 列表。
 *
 * 当前始终返回固定四件套(exec/close/wait/compress);后续可按 thread 状态裁剪。
 */
export function buildAvailableTools(_thread: ThreadContext): LlmTool[] {
  return OOC_TOOLS;
}
