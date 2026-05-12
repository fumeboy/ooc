import type { ThreadContext } from "../thinkable/context";
import type { LlmTool, LlmToolCall } from "../thinkable/llm/types";
import { handleCloseTool } from "./tools/close";
import { buildAvailableTools } from "./tools/index";
import { handleOpenTool } from "./tools/open";
import { handleRefineTool } from "./tools/refine";
import { handleSubmitTool } from "./tools/submit";
import { handleWaitTool } from "./tools/wait";

/** 单个 LLM tool 的运行时 handler 签名。 */
type ToolHandler = (thread: ThreadContext, args: Record<string, unknown>) => Promise<string | void>;

/** tool 名到 handler 的路由表；未实现的 tool 会转成 context_change 提示。 */
const TOOL_HANDLERS: Partial<Record<LlmToolCall["name"], ToolHandler>> = {
  open: handleOpenTool,
  refine: handleRefineTool,
  submit: handleSubmitTool,
  close: handleCloseTool,
  wait: handleWaitTool
};

/** 返回当前线程可暴露给 LLM 的工具定义。 */
export function getAvailableTools(thread: ThreadContext): LlmTool[] {
  return buildAvailableTools(thread);
}

/** 将 LLM tool call 分派给对应 handler，并返回可进入 function_call_output 的结果串。 */
export async function dispatchToolCall(
  thread: ThreadContext,
  toolCall: LlmToolCall
): Promise<string> {
  const handler = TOOL_HANDLERS[toolCall.name];
  if (!handler) {
    const message = `[${toolCall.name}] tool 暂未实现。`;
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: message
    });
    return JSON.stringify({ ok: false, error: message });
  }
  const output = await handler(thread, toolCall.arguments);
  if (typeof output === "string") {
    return output;
  }
  return JSON.stringify({ ok: true, tool: toolCall.name });
}
