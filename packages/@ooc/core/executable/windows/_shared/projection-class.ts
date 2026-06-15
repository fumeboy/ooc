/**
 * computeProjectionClass —— talk-family（会话）窗 class 的**唯一计算入口**。
 *
 * 设计依据（context.md core 7）：thread-context.json 只存 object id + 展示状态、**不存 class**；
 * class 是 POV 相关的投影，每次构造/读回时由本函数从 window 形态 + thread 视角动态算。
 *
 * talk-family 三形态（值与历史等价，本函数仅把分散在构造点的字面量收口为单一来源）：
 * - fork 子窗（isForkWindow）              → "talk"
 * - 跨对象/跨 session creator 窗（isCreatorWindow，非 fork）
 *     → super flow（sessionId="super"）取 "reflect_request"（额外挂沉淀 method），否则 "talk"
 * - peer 会话窗（既非 fork 也非 creator）  → "talk"
 *
 * 纯函数：不改 window / thread，仅返回投影 class。
 */

import type { BaseContextWindow } from "../../../_shared/types/context-window.js";
import { isSuperSessionId } from "@ooc/core/_shared/types/constants.js";
import type { ThreadContext } from "../../../thinkable/context.js";

/** talk-family 投影 class 的取值域。 */
export type ProjectionClass = "talk" | "reflect_request";

/** talk-family 窗的投影 flag 子集（计算 class 只需这两个形态标记）。 */
interface ProjectableWindow {
  isForkWindow?: boolean;
  isCreatorWindow?: boolean;
}

export function computeProjectionClass(
  window: Pick<BaseContextWindow, "id"> & ProjectableWindow,
  thread: ThreadContext,
): ProjectionClass {
  // fork 子窗：同对象父子内存通道，恒 talk。
  if (window.isForkWindow) return "talk";
  // 跨对象/跨 session creator 窗：super flow 的反思会话面用 reflect_request（额外沉淀 method），
  // 普通跨对象 callee 用 talk。peer 会话窗（非 creator）落到末尾，同样是 talk。
  if (window.isCreatorWindow) {
    return isSuperSessionId(thread.persistence?.sessionId ?? "") ? "reflect_request" : "talk";
  }
  return "talk";
}
