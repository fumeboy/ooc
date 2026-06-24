/**
 * OOC Tool 定义（exec/close/wait —— 重构后 3 原语）
 *
 * 旧 open/refine/submit 三件套合并为单一 `exec`；refine/submit 下沉为
 * MethodExecWindow 上注册的命令，与 talk_window 上的命令同构。
 */

import type { LlmTool } from "@ooc/core/thinkable/llm/types.js";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";

import { CLOSE_TOOL } from "./close.js";
import { EXEC_TOOL } from "./exec.js";
import { WAIT_TOOL } from "./wait.js";

/**
 * 所有 OOC tools —— **3 个稳定原语**：exec / close / wait。
 *
 * 新能力一律走 method / object type、不增顶层 tool（stable_tool_surface）。
 * compress / resize 是 **window method 协议**（无通用默认表——各 class 在自己 readable 的
 * window_methods 自声明：thread 窗 compress=无参折叠意图 / resize=自动压缩档位；内容窗
 * resize=展示档位），经 exec(method=compress|resize) 派发，不走中心 tool。
 */
export const OOC_TOOLS: LlmTool[] = [EXEC_TOOL, CLOSE_TOOL, WAIT_TOOL];

/**
 * 构建可用 tools 列表。当前始终返回固定三件套(exec/close/wait)；后续可按 thread 状态裁剪。
 */
export function getAvailableTools(_thread: ThreadContext): LlmTool[] {
  return OOC_TOOLS;
}

/** 单个 LLM tool 的运行时 handler 签名。 */
type ToolHandler = (
  thread: ThreadContext,
  args: Record<string, unknown>,
  registry?: ObjectRegistry,
) => Promise<string>;

function errorToolOutput(tool: string, error: string) {
  return JSON.stringify({ ok: false, tool, error });
}

/** tool 名到 handler 的路由表 —— 3 个稳定原语（exec / close / wait）。 */
const TOOL_HANDLERS: Partial<Record<LlmToolCall["name"], ToolHandler>> = {
  exec: handleExecTool,
  close: handleCloseTool,
  wait: handleWaitTool,
};

/** 将 LLM tool call 分派给对应 handler，并返回可进入 function_call_output 的结果串。 */
export async function dispatchToolCall(
  thread: ThreadContext,
  toolCall: LlmToolCall,
  registry: ObjectRegistry = builtinRegistry,
): Promise<string> {
  const handler = TOOL_HANDLERS[toolCall.name];
  if (!handler) {
    const message = `[${toolCall.name}] tool 暂未实现。`;
    return errorToolOutput(toolCall.name, message);
  }
  return await handler(thread, toolCall.arguments, registry);
}
