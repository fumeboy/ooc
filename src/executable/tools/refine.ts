import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { FormManager } from "../forms/form.js";
import { enrichProgramForm } from "../server/enrich.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

/** refine tool — 向 open 的 form 追加/修改 args */
export const REFINE_TOOL: LlmTool = {
  name: "refine",
  description: "向已 open 的 form 追加或修改参数。业务参数必须放在 args 对象里；多次调用 refine 会累积 args（后到覆盖先到）。等到参数齐全且语义合理，再调 submit(form_id) 执行。",
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
): Promise<string> {
  const successOutput = (message: string) => JSON.stringify({ ok: true, tool: "refine", message });
  const errorOutput = (error: string) => JSON.stringify({ ok: false, tool: "refine", error });
  const formId = args.form_id as string;
  const incoming = (args.args as Record<string, unknown> | undefined) ?? {};
  const formManager = FormManager.fromData(thread.activeForms ?? []);
  const existing = formManager.getForm(formId);

  if (!existing) {
    return errorOutput(`refine 失败：Form ${formId} 不存在。`);
  }
  if (existing.status !== "open") {
    return errorOutput(`refine 失败：Form ${formId} 不在 open 状态（当前 ${existing.status}）。`);
  }

  const updatedForm = formManager.refine(formId, incoming)!;
  let snapshot = formManager.toData();
  // 若 form 是 program command + function 模式，refine 后重抓方法签名
  const target = snapshot.find((f) => f.formId === formId);
  if (target) {
    const enriched = await enrichProgramForm(target, thread);
    if (enriched !== target) {
      snapshot = snapshot.map((f) => (f.formId === formId ? enriched : f));
    }
  }
  thread.activeForms = snapshot;
  return successOutput(`[refine] Form ${formId} 已累积参数。当前路径：${updatedForm.commandPaths.join(", ")}。`);
}
