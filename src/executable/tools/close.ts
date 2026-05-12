import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { FormManager } from "../forms/form.js";
import { MARK_PARAM } from "./schema.js";

/** close tool — 关闭 form。 */
export const CLOSE_TOOL: LlmTool = {
  name: "close",
  description:
    "关闭一个 open 状态：传 form_id 关闭已 open 的 form。必须提供 reason 说明原因。",
  inputSchema: {
    type: "object",
    properties: {
      form_id: {
        type: "string",
        description: "open 返回的 form_id（关闭 form 时使用）"
      },
      reason: {
        type: "string",
        description: "关闭原因，帮助下一轮理解为什么放弃。"
      },
      mark: MARK_PARAM
    },
    required: ["reason"]
  }
};

/** 执行 close tool：仅关闭 form。 */
export async function handleCloseTool(
  thread: ThreadContext,
  args: Record<string, unknown>
): Promise<void> {
  const reason = args.reason as string | undefined;
  if (!reason) {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: "[错误] close 缺少 reason 参数。"
    });
    return;
  }

  const formId = args.form_id as string | undefined;
  if (!formId) {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: "[错误] close 缺少 form_id 参数。"
    });
    return;
  }

  const formManager = FormManager.fromData(thread.activeForms ?? []);
  const form = formManager.close(formId);

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
