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

/** 执行 submit tool：把 form 切到 executing，跑 command，再切到 executed 并写入 result。 */
export async function handleSubmitTool(
  thread: ThreadContext,
  args: Record<string, unknown>
): Promise<void> {
  const formId = args.form_id as string;
  const formManager = FormManager.fromData(thread.activeForms ?? []);
  const existing = formManager.getForm(formId);

  if (!existing) {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[错误] submit 失败：Form ${formId} 不存在。`
    });
    return;
  }
  if (existing.status !== "open") {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[错误] submit 失败：Form ${formId} 不在 open 状态（当前 ${existing.status}）。`
    });
    return;
  }

  const submitted = formManager.submit(formId)!;
  thread.activeForms = formManager.toData();
  thread.events.push({
    category: "context_change",
    kind: "inject",
    text: `[form executing] formId=${formId} command=${submitted.command}`
  });

  const finalArgs = { ...submitted.accumulatedArgs, ...args };
  let result: string | undefined;
  try {
    result = await executeCommand(submitted.command, { thread, form: submitted, args: finalArgs });
  } catch (error) {
    result = `[command-error] ${(error as Error).message}`;
  }

  formManager.markExecuted(formId, result);
  thread.activeForms = formManager.toData();
  thread.events.push({
    category: "context_change",
    kind: "inject",
    text: `[form executed] formId=${formId}`
  });
}
