import type { ToolDefinition } from "../../thinkable/client.js";
import { MARK_PARAM } from "./schema.js";

/** close tool — 关闭上下文 */
export const CLOSE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "close",
    description: "关闭一个已打开的上下文。command 类型等同于取消指令，trait/skill 类型等同于卸载知识。",
    parameters: {
      type: "object",
      properties: {
        form_id: {
          type: "string",
          description: "open 返回的 form_id",
        },
        mark: MARK_PARAM,
      },
      required: ["form_id"],
    },
  },
};
