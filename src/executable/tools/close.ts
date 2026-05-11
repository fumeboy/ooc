import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { FormManager } from "../forms/form.js";
import { MARK_PARAM } from "./schema.js";

/** close tool — 关闭 form 或卸载手动 pin 的 knowledge。 */
export const CLOSE_TOOL: LlmTool = {
  name: "close",
  description:
    "关闭一个 open 状态：传 form_id 关闭已 open 的 form；或传 type='knowledge' + path 卸载手动 pin 的 knowledge。必须提供 reason 说明原因。",
  inputSchema: {
    type: "object",
    properties: {
      form_id: {
        type: "string",
        description: "open 返回的 form_id（关闭 form 时使用）"
      },
      type: {
        type: "string",
        enum: ["knowledge"],
        description: "type='knowledge' 时配合 path 卸载已 pin 的 knowledge"
      },
      path: {
        type: "string",
        description: "type='knowledge' 时填要卸载的 knowledge path"
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

/** 执行 close tool：按 type 路由到 knowledge 卸载分支或 form 关闭分支。 */
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

  // 分支 1：卸载手动 pin 的 knowledge
  if (args.type === "knowledge") {
    const path = args.path as string | undefined;
    if (!path) {
      thread.events.push({
        category: "context_change",
        kind: "inject",
        text: "[错误] close(type=knowledge) 缺少 path 参数。"
      });
      return;
    }
    const before = thread.pinnedKnowledge ?? [];
    if (!before.includes(path)) {
      thread.events.push({
        category: "context_change",
        kind: "inject",
        text: `[提示] knowledge ${path} 未被 pin，无需 close。`
      });
      return;
    }
    thread.pinnedKnowledge = before.filter((p) => p !== path);
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[close] knowledge ${path} 已卸载。原因：${reason}`
    });
    return;
  }

  // 分支 2：关闭 form
  const formId = args.form_id as string | undefined;
  if (!formId) {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: "[错误] close 缺少 form_id 参数（或缺少 type=knowledge + path）。"
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
