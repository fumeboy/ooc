/**
 * OOC Tool 定义（v2 — open/refine/submit/close/wait）
 *
 * 每个 tool 维护在同名文件中，目录结构即能力清单：
 * - `tools/open.ts`
 * - `tools/refine.ts`
 * - `tools/submit.ts`
 *
 * index 只负责聚合与统一导出，避免单个大文件吞掉目录可读性。
 */

import type { ToolDefinition } from "../../thinkable/llm/client.js";

import { CLOSE_TOOL } from "./close.js";
import { OPEN_TOOL } from "./open.js";
import { REFINE_TOOL } from "./refine.js";
import { SUBMIT_TOOL } from "./submit.js";
import { WAIT_TOOL } from "./wait.js";

export { CLOSE_TOOL } from "./close.js";
export { OPEN_TOOL } from "./open.js";
export { REFINE_TOOL } from "./refine.js";
export { MARK_PARAM, TITLE_PARAM } from "./schema.js";
export { SUBMIT_TOOL } from "./submit.js";
export { WAIT_TOOL } from "./wait.js";

/** 所有 OOC tools */
export const OOC_TOOLS: ToolDefinition[] = [OPEN_TOOL, REFINE_TOOL, SUBMIT_TOOL, CLOSE_TOOL, WAIT_TOOL];

/**
 * 构建可用 tools 列表
 *
 * 始终返回五个 tool（open/refine/submit/close/wait）。
 */
export function buildAvailableTools(): ToolDefinition[] {
  return OOC_TOOLS;
}
