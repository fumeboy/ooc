/**
 * close tool — 关闭任意 ContextWindow（对象实例）。
 *
 * 原语 close：
 * - 级联：parent 关闭 → 所有 sub-window 强制关闭（WindowManager.close 内部处理）
 * - 从 thread 移除该实例
 *
 * 注：旧契约里 type 注册的 onClose hook（creator talk_window 拒绝关闭、fork 子窗 archive 子线程等）
 * 已随承重墙 deferred hook 一并废弃；如需 close 副作用，由对应 class 的方法层自理。
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { builtinRegistry, type ObjectRegistry } from "../../runtime/object-registry.js";
import { WindowManager } from "../windows/_shared/manager.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

export const CLOSE_TOOL: LlmTool = {
  name: "close",
  description:
    "关闭一个 ContextWindow（对象实例）。必填 window_id 与 reason。关闭会级联关闭其子窗。",
  inputSchema: {
    type: "object",
    properties: {
      title: TITLE_PARAM,
      window_id: {
        type: "string",
        description: "要关闭的 window 的 id",
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
  registry: ObjectRegistry = builtinRegistry,
): Promise<string> {
  const reason = args.reason as string | undefined;
  if (!reason) return errorOutput("close 缺少 reason 参数。");
  const windowId = args.window_id as string | undefined;
  if (!windowId) return errorOutput("close 缺少 window_id 参数。");

  const mgr = WindowManager.fromThread(thread, registry);
  // 接线 persist leaf 刷盘回调：close 移除实例后经 reportContextEdit eager 刷 thread-context.json。
  await mgr.attachPersistence(thread);
  const existing = mgr.get(windowId);
  if (!existing) return errorOutput(`close 失败：window ${windowId} 不存在。`);

  await mgr.close(windowId);
  thread.contextWindows = mgr.toData();
  return successOutput(`[close] window ${windowId} 已关闭。原因：${reason}`);
}
