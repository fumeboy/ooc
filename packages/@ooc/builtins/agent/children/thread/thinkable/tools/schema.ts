/**
 * thread thinkable —— 4 tool 原语定义（LLM 看到的 schema）。
 *
 * 对应 ./dispatch.ts 的 exec/close/wait/open 处理。这里只声明 LLM 协议层的 tool 元数据。
 *
 * issue E 加 `open` 原语：在不行使 `exec` 的前提下对目标 method 开一张
 * `method_exec_form`，把 `want`（agent 想做什么的自然语言意图）带进 form data —— 让 agent 在
 * 真正动手前把"为什么调"显式表达进上下文。
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

export const OPEN_TOOL: LlmTool = {
  name: "open",
  description:
    "Open a method_exec_form for a target object's method WITHOUT executing it. Use this when you want to make your intent (the 'want') explicit before acting—the form lets you refine args, then submit when ready. Prefer `exec` for direct, low-stakes single-step calls.",
  inputSchema: {
    type: "object",
    properties: {
      objectId: { type: "string", description: "Target object id." },
      methodName: { type: "string", description: "Method name to open a form for." },
      want: {
        type: "string",
        description: "Why you want to call this method (natural language intent). Written into the form for the next turn to see.",
      },
    },
    required: ["objectId", "methodName", "want"],
  },
};

/** thinkloop 每轮暴露给 LLM 的 4 tool 原语（issue E）。 */
export const PRIMITIVE_TOOLS: LlmTool[] = [EXEC_TOOL, CLOSE_TOOL, WAIT_TOOL, OPEN_TOOL];
