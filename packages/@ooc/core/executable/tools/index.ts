/**
 * OOC Tool 定义（exec/close/wait —— 重构后 3 原语）
 *
 * 旧 open/refine/submit 三件套合并为单一 `exec`；refine/submit 下沉为
 * MethodExecWindow 上注册的命令，与 talk_window 上的命令同构。
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";

import { CLOSE_TOOL } from "./close.js";
import { EXEC_TOOL } from "./exec.js";
import { WAIT_TOOL } from "./wait.js";

/**
 * 所有 OOC tools —— **3 个稳定原语**：exec / close / wait。
 *
 * compress 不再是顶层 tool：它是"调整信息展示"的**方法**（与 file_window 的 set_viewport 同类），
 * 经 `exec(method="compress", args={scope,...})` 调用（exec.ts 拦截 method="compress"），与 expand 对称。
 * 新能力一律走 method / object type、不增顶层 tool（stable_tool_surface）。
 */
export const OOC_TOOLS: LlmTool[] = [EXEC_TOOL, CLOSE_TOOL, WAIT_TOOL];

/**
 * 构建可用 tools 列表。当前始终返回固定三件套(exec/close/wait)；后续可按 thread 状态裁剪。
 */
export function buildAvailableTools(_thread: ThreadContext): LlmTool[] {
  return OOC_TOOLS;
}
