import type { ToolDefinition } from "../../thinkable/client.js";
import { MARK_PARAM } from "./schema.js";

/** wait tool — 切换线程到 waiting 状态 */
export const WAIT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "wait",
    description: "将当前线程切换到 waiting 状态，暂停执行。适用于：等待用户输入、等待外部事件、主动让出执行权。线程会在收到新的 inbox 消息时被唤醒。",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "等待原因",
        },
        mark: MARK_PARAM,
      },
      required: ["reason"],
    },
  },
};
