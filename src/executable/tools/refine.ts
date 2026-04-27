import type { ToolDefinition } from "../../thinkable/client.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

/** refine tool — 向 open 的 form 追加/修改 args（不执行） */
export const REFINE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "refine",
    description:
      "向已 open 的 form 追加或修改参数（不执行）。多次调用 refine 累积 args（后到覆盖先到），可能深化命令路径，从而触发新一轮知识激活。等到参数齐全且语义合理，再调 submit() 执行。",
    parameters: {
      type: "object",
      properties: {
        title: TITLE_PARAM,
        form_id: { type: "string", description: "open 返回的 form_id" },
        args: {
          type: "object",
          description: "要追加或覆盖的参数键值对。后到覆盖先到。",
        },
        mark: MARK_PARAM,
      },
      required: ["title", "form_id"],
    },
  },
};
