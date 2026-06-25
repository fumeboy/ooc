/**
 * thread thinkable —— 3 tool 原语定义（LLM 看到的 schema）。
 *
 * 对应 ../tools/index.ts 的 exec/close/wait 处理。这里只声明 LLM 协议层的 tool 元数据。
 */
import type { LlmTool } from "@ooc/core/thinkable/llm/types.js";

export const EXEC_TOOL: LlmTool = {
  name: "exec",
  description:
    "Execute a method on one of your context windows. Pick the right window by window_id and call its method by name (object method changes data / side effects; window method only changes display).",
  inputSchema: {
    type: "object",
    properties: {
      window_id: { type: "string", description: "Target window id (from your context windows list)." },
      method: { type: "string", description: "Method name to call." },
      args: { type: "object", description: "Method args.", additionalProperties: true },
    },
    required: ["window_id", "method"],
  },
};

export const CLOSE_TOOL: LlmTool = {
  name: "close",
  description:
    "Close a window. Removes it from your context. Structural windows (closable=false) cannot be closed.",
  inputSchema: {
    type: "object",
    properties: {
      window_id: { type: "string", description: "Window id to close." },
    },
    required: ["window_id"],
  },
};

export const WAIT_TOOL: LlmTool = {
  name: "wait",
  description:
    "Wait for new input on a specific window (typically a talk window). Sets this thread to waiting; scheduler wakes it when new messages/events arrive.",
  inputSchema: {
    type: "object",
    properties: {
      window_id: { type: "string", description: "Window id to wait on." },
    },
    required: ["window_id"],
  },
};

/** thinkloop 每轮暴露给 LLM 的 3 tool。 */
export const PRIMITIVE_TOOLS: LlmTool[] = [EXEC_TOOL, CLOSE_TOOL, WAIT_TOOL];
