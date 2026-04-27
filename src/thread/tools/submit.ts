import type { ToolDefinition } from "../../thinkable/client.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

/** submit tool — 提交执行（仅 command 类型） */
export const SUBMIT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "submit",
    description: "提交指令执行。必须先 open 获取 form_id，所有参数通过 refine() 累积后再 submit。记得带 title 参数，用一句话说明本次提交的意图。各指令的参数语义参见 COMMAND_TABLE / trait 文档。",
    parameters: {
      type: "object",
      properties: {
        title: TITLE_PARAM,
        form_id: { type: "string", description: "open 返回的 form_id" },
        mark: MARK_PARAM,
      },
      required: ["title", "form_id"],
    },
  },
};
