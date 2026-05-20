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

const successOutput = (message: string, result?: string, autoRemoved?: boolean, windowId?: string) =>
  JSON.stringify({
    ok: true,
    tool: "submit",
    message,
    ...(result !== undefined ? { result } : {}),
    ...(autoRemoved ? { auto_removed: true } : {}),
    // submit 触发的 command 通常会派生 sub-window (grep→search_window, open_file→file_window, ...).
    // 把它的 id 写到 output, 让 ChatPanel 的 link 按钮可以跳转到这个真正仍在 context 中的 window,
    // 而不是已 auto_removed 的 form_id (用户反馈 2026-05-20).
    ...(windowId ? { window_id: windowId } : {}),
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

  // 记录 submit 前的 window id 集合, 用来识别本次 submit 派生的新 sub-window
  const beforeIds = new Set((thread.contextWindows ?? []).map((w) => w?.id).filter(Boolean) as string[]);

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
  // 找到本次 submit 派生的第一个新 window (典型: grep→search, open_file→file 等).
  // 排除 form 自己 (id === formId) 以防失败 form 还在 contextWindows.
  const createdWindowId = (thread.contextWindows ?? [])
    .map((w) => w?.id)
    .filter((id): id is string => Boolean(id) && id !== formId && !beforeIds.has(id))[0];
  return successOutput(messageBase, result, autoRemoved, createdWindowId);
}
