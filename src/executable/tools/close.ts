import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { FormManager } from "../forms/form.js";
import { MARK_PARAM } from "./schema.js";

/** close tool — 关闭上下文 */
export const CLOSE_TOOL: LlmTool = {
  name: "close",
  description: "关闭一个已 open 的 form。必须提供 reason，说明为什么放弃这个行动。",
  inputSchema: {
    type: "object",
    properties: {
      form_id: {
        type: "string",
        description: "open 返回的 form_id",
      },
      reason: {
        type: "string",
        description: "关闭原因，帮助下一轮理解为什么放弃这个行动。"
      },
      mark: MARK_PARAM,
    },
    required: ["form_id", "reason"],
  },
};

// close 只关闭 form
export async function handleCloseTool(
  thread: ThreadContext,
  args: Record<string, unknown>
): Promise<void> {
  const formId = args.form_id as string;
  const reason = args.reason as string;

  if (!formId || !reason) {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: "[错误] close 参数不完整：必须提供 form_id 和 reason。"
    });
    return;
  }

  const formManager = FormManager.fromData(thread.activeForms ?? []);
  const form = formManager.cancel(formId);

  if (!form) {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[提示] Form ${formId} 不存在（可能已被 submit 消费）。`
    });
    return;
  }

  thread.activeForms = formManager.toData();
  thread.events.push({
    category: "context_change",
    kind: "inject",
    text: `[close] Form ${form.formId} 已关闭。原因：${reason}`
  });
}
