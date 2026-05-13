import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { MARK_PARAM } from "./schema.js";

/** wait tool — 切换线程到 waiting 状态 */
export const WAIT_TOOL: LlmTool = {
  name: "wait",
  description: "将当前线程切换到 waiting 状态，暂停执行。适用于：等待用户输入、等待外部事件、主动让出执行权。线程会在收到新的 inbox 消息时被唤醒。",
  inputSchema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "等待原因",
      },
      mark: MARK_PARAM,
    },
    required: ["reason"],
  },
};

/** 执行 wait tool：把当前线程切到 explicit_wait，并写入可见的上下文变化提示。 */
export async function handleWaitTool(
  thread: ThreadContext,
  args: Record<string, unknown>
): Promise<string> {
  const reason = (args.reason as string | undefined) ?? "";
  thread.status = "waiting";
  thread.waitingType = "explicit_wait";
  return JSON.stringify({ ok: true, tool: "wait", message: `[wait] 线程进入等待状态: ${reason}` });
}
