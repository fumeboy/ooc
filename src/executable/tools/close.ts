/**
 * close tool — 关闭任意 ContextWindow（form / do_window 等）。
 *
 * spec § 5 原语 close：
 * - 级联：parent 关闭 → 所有 sub-window 强制关闭
 * - 释放该 window 引入的 knowledge 引用计数（WindowManager 内部处理）
 * - type 注册的 onClose hook 决定额外副作用（do_window archive、creator window 拒绝等）
 * - command_exec 成功执行后已自动消失，无需 close；本 tool 用于 close 失败 form / do_window
 *   （待办已塌缩为 todos.json，用 todo_remove/todo_check 管理，不再 close）
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { WindowManager } from "../windows/index.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

export const CLOSE_TOOL: LlmTool = {
  name: "close",
  description:
    "关闭一个 ContextWindow（form / do_window 等）。必填 window_id 与 reason。关闭 do_window 等同于归档对应子线程；某些系统 window（如 creator do_window）会拒绝关闭。（待办已塌缩为 todos.json，用 todo_remove/todo_check 管理，不再 close。）",
  inputSchema: {
    type: "object",
    properties: {
      title: TITLE_PARAM,
      window_id: {
        type: "string",
        description: "要关闭的 window 的 id（command_exec form 也是一种 window）",
      },
      reason: { type: "string", description: "关闭原因，帮助下一轮理解" },
      mark: MARK_PARAM,
    },
    required: ["window_id", "reason"],
  },
};

const successOutput = (message: string) => JSON.stringify({ ok: true, tool: "close", message });
const errorOutput = (error: string) => JSON.stringify({ ok: false, tool: "close", error });

export async function handleCloseTool(
  thread: ThreadContext,
  args: Record<string, unknown>,
): Promise<string> {
  const reason = args.reason as string | undefined;
  if (!reason) return errorOutput("close 缺少 reason 参数。");
  const windowId = args.window_id as string | undefined;
  if (!windowId) return errorOutput("close 缺少 window_id 参数。");

  const mgr = WindowManager.fromThread(thread);
  const existing = mgr.get(windowId);
  if (!existing) return errorOutput(`close 失败：window ${windowId} 不存在。`);

  const closed = await mgr.close(windowId, thread);
  thread.contextWindows = mgr.toData();
  if (!closed) {
    return errorOutput(`close 被拒绝：window ${windowId} 类型不允许 close（如 creator do_window）。`);
  }
  return successOutput(`[close] window ${windowId} 已关闭。原因：${reason}`);
}
