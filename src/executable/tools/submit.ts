import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { executeCommand } from "../commands/index.js";
import { FormManager } from "../forms/form.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

/** submit tool — 提交执行（仅 command 类型） */
export const SUBMIT_TOOL: LlmTool = {
  name: "submit",
  description: "提交指令执行。必须先 open 获取 form_id，再将所有参数填充完毕后再 submit。",
  inputSchema: {
    type: "object",
    properties: {
      title: TITLE_PARAM,
      form_id: { type: "string", description: "open 返回的 form_id" },
      mark: MARK_PARAM,
    },
    required: ["title", "form_id"],
  },
};

/** 执行 submit tool：消费 form，并把累积参数交给 command 层接口。 */
export async function handleSubmitTool(
  thread: ThreadContext,
  args: Record<string, unknown>
): Promise<void> {
  const formId = args.form_id as string;
  const formManager = FormManager.fromData(thread.activeForms ?? []);
  const form = formManager.submit(formId);

  if (!form) {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[错误] Form ${formId} 不存在。`
    });
    return;
  }

  const finalArgs = { ...form.accumulatedArgs, ...args };
  await executeCommand(form.command, { thread, form, args: finalArgs });

  thread.activeForms = formManager.toData();
  thread.events.push({
    category: "context_change",
    kind: "inject",
    text: `[submit] Form ${form.formId} 已提交（${form.command}）。`
  });
}
