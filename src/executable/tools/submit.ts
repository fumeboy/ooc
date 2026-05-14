/**
 * submit tool — 真正执行 command_exec form 中的 command。
 *
 * spec § 5 原语 submit：
 * - status 切换：open → executing → executed
 * - 成功：自动从 contextWindows 移除
 * - 失败：保留 executed 状态 + result 含错误，需要 LLM 显式 close
 * - 不接受新业务参数；所有 args 都必须先通过 open(args) 或 refine 给齐
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { WindowManager } from "../windows/index.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

export const SUBMIT_TOOL: LlmTool = {
  name: "submit",
  description:
    "提交一个 command_exec form 真正执行。submit 不接受新业务参数。成功执行后系统会自动从 context 移除该 form；失败则保留 result 字段，需要你 close。",
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

const successOutput = (message: string, result?: string, autoRemoved?: boolean) =>
  JSON.stringify({
    ok: true,
    tool: "submit",
    message,
    ...(result !== undefined ? { result } : {}),
    ...(autoRemoved ? { auto_removed: true } : {}),
  });
const errorOutput = (error: string) => JSON.stringify({ ok: false, tool: "submit", error });

export async function handleSubmitTool(
  thread: ThreadContext,
  args: Record<string, unknown>,
): Promise<string> {
  const formId = args.form_id as string | undefined;
  if (!formId) return errorOutput("submit 缺少 form_id 参数。");

  const mgr = WindowManager.fromThread(thread);
  const target = mgr.get(formId);
  if (!target) return errorOutput(`submit 失败：Form ${formId} 不存在。`);
  if (target.type !== "command_exec") {
    return errorOutput(`submit 失败：window ${formId} 不是 command_exec 类型。`);
  }
  if (target.status !== "open") {
    return errorOutput(`submit 失败：Form ${formId} 不在 open 状态（当前 ${target.status}）。`);
  }

  let result: string | undefined;
  try {
    result = await mgr.submit(formId, thread);
  } catch (err) {
    return errorOutput(`submit 失败：${(err as Error).message}`);
  }

  thread.contextWindows = mgr.toData();
  const after = mgr.get(formId);
  const autoRemoved = !after; // 成功时 mgr.submit 已经移除
  const title = (args.title as string | undefined)?.trim() || target.command;
  const messageBase = autoRemoved
    ? `[form executed] form "${title}" 已成功执行并自动释放。`
    : `[form executed] form "${title}" 执行完成（保留待 close）。`;
  return successOutput(messageBase, result, autoRemoved);
}
