import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { FormManager } from "../forms/form.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

/** refine tool — 向 open 的 form 追加/修改 args */
export const REFINE_TOOL: LlmTool = {
  name: "refine",
  description: "向已 open 的 form 追加或修改参数。多次调用 refine 累积 args（后到覆盖先到），系统可能会根据参数匹配出新的知识补充到上下文中。等到参数齐全且语义合理，再调 submit() 执行。",
  inputSchema: {
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
};

/** 执行 refine tool：只累积参数并重算 command paths，不触发 command 执行。 */
export async function handleRefineTool(
  thread: ThreadContext,
  args: Record<string, unknown>
): Promise<void> {
  const formId = args.form_id as string;
  const incoming = (args.args as Record<string, unknown> | undefined) ?? {};
  const formManager = FormManager.fromData(thread.activeForms ?? []);
  const existing = formManager.getForm(formId);

  if (!existing) {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[错误] refine 失败：Form ${formId} 不存在。`
    });
    return;
  }
  if (existing.status !== "open") {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[错误] refine 失败：Form ${formId} 不在 open 状态（当前 ${existing.status}）。`
    });
    return;
  }

  const updatedForm = formManager.refine(formId, incoming)!;
  thread.activeForms = formManager.toData();
  thread.events.push({
    category: "context_change",
    kind: "inject",
    text: `[refine] Form ${formId} 已累积参数。当前路径：${updatedForm.commandPaths.join(", ")}。`
  });
}
