/**
 * refine tool — 向 command_exec form 累积参数。
 *
 * spec § 5 原语：refine 仅作用于 command_exec window；累积 args、重算 commandPaths、
 * 重算 knowledge 激活；form.status 必须 == "open"。
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { WindowManager } from "../windows/index.js";
import { enrichProgramFormCommand } from "../server/enrich.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

export const REFINE_TOOL: LlmTool = {
  name: "refine",
  description:
    "向已 open 的 command_exec form 累积参数。多次调用会叠加；填齐参数后用 submit(form_id) 触发执行。submit 不接受新参数，业务参数只在 open 或 refine 中提供。",
  inputSchema: {
    type: "object",
    properties: {
      title: TITLE_PARAM,
      form_id: { type: "string", description: "open 返回的 form_id" },
      form_args: {
        type: "object",
        description: "要累积或覆盖的参数键值对",
      },
      mark: MARK_PARAM,
    },
    required: ["title", "form_id", "form_args"],
  },
};

const successOutput = (message: string) => JSON.stringify({ ok: true, tool: "refine", message });
const errorOutput = (error: string) => JSON.stringify({ ok: false, tool: "refine", error });

export async function handleRefineTool(
  thread: ThreadContext,
  args: Record<string, unknown>,
): Promise<string> {
  const formId = args.form_id as string | undefined;
  if (!formId) return errorOutput("refine 缺少 form_id 参数。");
  const incoming = (args.form_args as Record<string, unknown> | undefined) ?? {};

  const mgr = WindowManager.fromThread(thread);
  const ok = mgr.refine(formId, incoming);
  if (!ok) {
    const existing = mgr.get(formId);
    if (!existing) return errorOutput(`refine 失败：Form ${formId} 不存在。`);
    return errorOutput(`refine 失败：Form ${formId} 不在 open 状态（当前 ${existing.status}）。`);
  }

  // program function 模式时刷新方法签名 knowledge
  const target = mgr.get(formId);
  if (target && target.type === "command_exec" && target.command === "program") {
    await enrichProgramFormCommand(target, thread);
  }

  thread.contextWindows = mgr.toData();
  const updated = mgr.get(formId);
  const paths = updated && updated.type === "command_exec" ? updated.commandPaths.join(", ") : "";
  return successOutput(`[refine] Form ${formId} 已累积参数。当前路径：${paths}。`);
}
