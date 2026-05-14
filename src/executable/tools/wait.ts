/**
 * wait tool — 把当前线程切到 waiting 状态，等待 inbox 新消息唤醒。
 *
 * spec § 5 原语 wait + § 等待语义的简化：
 * - 不再写 waitingType（字段已删）
 * - 用 thread.inboxSnapshotAtWait 记录入眠时刻 inbox 长度，scheduler 据此判断是否有新消息
 * - 任何 inbox 新消息（子线程 end 通知 / talk 回复 / 外部 inject）都能唤醒
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

export const WAIT_TOOL: LlmTool = {
  name: "wait",
  description:
    "把当前线程切到 waiting 状态，暂停执行直到 inbox 收到任意新消息。适用于：等待用户输入 / 等待子线程结束 / 主动让出执行权。必填 reason。",
  inputSchema: {
    type: "object",
    properties: {
      title: TITLE_PARAM,
      reason: { type: "string", description: "等待原因" },
      mark: MARK_PARAM,
    },
    required: ["reason"],
  },
};

export async function handleWaitTool(
  thread: ThreadContext,
  args: Record<string, unknown>,
): Promise<string> {
  const reason = (args.reason as string | undefined) ?? "";
  thread.status = "waiting";
  thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
  return JSON.stringify({
    ok: true,
    tool: "wait",
    message: `[wait] 线程进入 waiting，等待 inbox 新消息。原因：${reason}`,
  });
}
