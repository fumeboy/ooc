/**
 * close tool — 关闭任意 ContextWindow（对象实例）。
 *
 * 原语 close：
 * - 结构窗保护：`inst.closable === false`（construct 期标的恒在通道，如 thread/creator 门面窗）→ 拒关、报错。
 * - 级联：parent 关闭 → 所有 sub-window 强制关闭（WindowManager.close 内部处理）
 * - 从 thread 移除该实例
 * - 移窗后：若该窗引用某对象（`referencedObjectId`），且该对象 session refcount 归零 → 经
 *   `dispatchUnactiveIfZero` 单次泛型派发该 class 的 `unactive` 钩子（refcount 归 0 触发；
 *   thread 的 unactive 通知被解引用线程「无消息订阅者」、由其自决（不强制终结）。
 *
 * 注：旧契约里 type 注册的 onClose hook 已随承重墙 deferred hook 废弃；副作用现由
 * class 的 `unactive` 生命周期钩子（refcount 0↔1）+ `closable` 标记表达。
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import { builtinRegistry, type ObjectRegistry } from "../../runtime/object-registry.js";
import { WindowManager } from "../../runtime/window-manager.js";
import { referencedObjectId, dispatchUnactiveIfZero } from "../../runtime/object-lifecycle.js";
import { classOf } from "../../_shared/types/context-window.js";
import { getSessionObjectTable } from "../../runtime/session-object-table.js";
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

  // 结构窗保护：construct 期标的恒在通道（thread 与 creator 的门面窗）不可关。
  if (existing.closable === false) {
    return errorOutput(
      `[close] window ${windowId} 不可关闭（结构窗：thread 与 creator 的恒在通道）。`,
    );
  }

  // 关后从 map 取不到实例 → 关前先捕获它引用的目标对象 id + 它的 class（派生派发所需）。
  const target = referencedObjectId(existing, getSessionObjectTable(thread));
  const targetClass = classOf(existing);

  await mgr.close(windowId);
  thread.contextWindows = mgr.toData(); // 先同步，refcount 才看得到「窗已移除」
  if (target) await dispatchUnactiveIfZero(thread, target, targetClass, registry);
  return successOutput(`[close] window ${windowId} 已关闭。原因：${reason}`);
}
