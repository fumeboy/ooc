/**
 * wait tool — 显式声明"等指定 window 上的未来 IO 事件"，把 thread 切到 waiting。
 *
 * spec: docs/superpowers/specs/2026-05-17-wait-requires-dependency-design.md
 *
 * - `on` 必填：必须 resolve 到当前 contextWindows 一个 open 且可产生未来 IO 的 window
 *   （talk_window / do_window）。
 * - 没有任何合法 `on` 候选时 → reject，强 nudge 改 end command。
 * - thread.inboxSnapshotAtWait 仍用于 wakeup（Phase 1 wakeup 逻辑不变）；
 *   thread.waitingOn 仅作 observability，不参与 wakeup 决策。
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

export const WAIT_TOOL: LlmTool = {
  name: "wait",
  description:
    "声明你在等指定 window 上的未来 IO 事件，把当前 thread 切到 waiting。" +
    "on 必填且必须 resolve 到当前 contextWindows 里 open 状态的 talk_window 或 do_window" +
    "（这是允许产生未来 IO 的两种 window type）。没有合法 on 时不能 wait——" +
    "意味着任务已完成 / 无 IO 预期，请改用 end command 收尾。",
  inputSchema: {
    type: "object",
    properties: {
      title: TITLE_PARAM,
      on: {
        type: "string",
        description:
          "未来 IO 来源 window id。必须是当前 contextWindows 里 open 的 talk_window 或 do_window。" +
          "talk_window：等对端发新消息（creator talk 一律合法；自建 talk 需先 say 过）。" +
          "do_window：等子线程 outbox 回报（子线程必须仍 running/waiting）。",
      },
      reason: {
        type: "string",
        description: "（可选）人类可读的等待说明，observability 用。",
      },
      mark: MARK_PARAM,
    },
    required: ["on"],
  },
};

export async function handleWaitTool(
  thread: ThreadContext,
  args: Record<string, unknown>,
): Promise<string> {
  // Task 2 will fill in the actual validation; this is the Task 1 stub.
  const on = args.on as string | undefined;
  const reason = (args.reason as string | undefined) ?? "";
  thread.status = "waiting";
  thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
  thread.waitingOn = on;
  return JSON.stringify({
    ok: true,
    tool: "wait",
    message: `[wait] 线程进入 waiting，等待 ${on ?? "(unset)"} 上的事件。原因：${reason}`,
  });
}
