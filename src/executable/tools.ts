import type { ThreadContext } from "../thinkable/context";
import type { LlmTool, LlmToolCall } from "../thinkable/llm/types";
import { handleCloseTool } from "./tools/close";
import { buildAvailableTools } from "./tools/index";
import { handleOpenTool } from "./tools/open";
import { handleRefineTool } from "./tools/refine";
import { handleSubmitTool } from "./tools/submit";
import { handleWaitTool } from "./tools/wait";

type ToolHandler = (thread: ThreadContext, args: Record<string, unknown>) => Promise<void>;

const TOOL_HANDLERS: Partial<Record<LlmToolCall["name"], ToolHandler>> = {
  open: handleOpenTool,
  refine: handleRefineTool,
  submit: handleSubmitTool,
  close: handleCloseTool,
  wait: handleWaitTool
};

// getAvailableTools 连接到真实的工具实现
export function getAvailableTools(thread: ThreadContext): LlmTool[] {
  return buildAvailableTools(thread);
}

// dispatchToolCall 只做路由，具体逻辑留在各 tool 文件中。
export async function dispatchToolCall(
  thread: ThreadContext,
  toolCall: LlmToolCall
): Promise<void> {
  const handler = TOOL_HANDLERS[toolCall.name];
  if (!handler) {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[${toolCall.name}] tool 暂未实现。`
    });
    return;
  }
  await handler(thread, toolCall.arguments);
}
