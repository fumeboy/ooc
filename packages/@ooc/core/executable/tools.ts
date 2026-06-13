import type { ThreadContext } from "../thinkable/context";
import type { LlmTool, LlmToolCall } from "../thinkable/llm/types";
import type { ObjectRegistry } from "./windows/_shared/registry";
import { builtinRegistry } from "./windows/index.js";
import { handleCloseTool } from "./tools/close";
import { buildAvailableTools } from "./tools/index";
import { handleExecTool } from "./tools/exec";
import { handleWaitTool } from "./tools/wait";

/** 单个 LLM tool 的运行时 handler 签名。 */
type ToolHandler = (
  thread: ThreadContext,
  args: Record<string, unknown>,
  registry?: ObjectRegistry,
) => Promise<string | void>;

function successToolOutput(tool: string, message?: string) {
  return JSON.stringify(message ? { ok: true, tool, message } : { ok: true, tool });
}

function errorToolOutput(tool: string, error: string) {
  return JSON.stringify({ ok: false, tool, error });
}

/** tool 名到 handler 的路由表 —— 3 个稳定原语。compress 不在此：它是经 exec 调用的方法（exec.ts 拦截 method="compress"）。 */
const TOOL_HANDLERS: Partial<Record<LlmToolCall["name"], ToolHandler>> = {
  exec: handleExecTool,
  close: handleCloseTool,
  wait: handleWaitTool,
};

/** 返回当前线程可暴露给 LLM 的工具定义。 */
export function getAvailableTools(thread: ThreadContext): LlmTool[] {
  return buildAvailableTools(thread);
}

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
  const output = await handler(thread, toolCall.arguments, registry);
  if (typeof output === "string") {
    return output;
  }
  return successToolOutput(toolCall.name);
}
