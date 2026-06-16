/**
 * computeProjectionClass —— 会话窗投影 class 的**唯一计算入口**，由 thread readable 内部调用。
 *
 * 设计依据（context.md 核心 2/8/9）：会话窗 inst.class 一律 = `_builtin/thread`（唯一会话载体注册
 * class）；talk/reflect_request 是 POV 投影出的 window class，每次渲染时由本函数从窗形态 + thread
 * 视角动态算，作为 ReadableProjection.class 返回，**不持久化、不写 inst.class**。
 *
 * 两类视图（context.md core 9：self-view ≠ other-view）：
 * - **self-view（creator 窗）= thread 自己与其 creator 的对话**：
 *     super flow（sessionId="super"）取 "reflect_request"（thread 的反思自视，额外挂沉淀 method），
 *     否则取 "thread"。fork 子窗（同对象父子）的 creator 窗也是 self-view → 同走此分支取 "thread"。
 * - **other-view（peer/sub 会话窗，非 creator，含父侧 fork 子窗）= 与对端 thread 的对话** → "talk"。
 *
 * 即 isForkWindow 不再影响 class；判别只看「这条窗是不是本 thread 的 self-view」——creator 窗身份
 * 由 id 派生（`isCreatorWindowId`，id=`creatorWindowIdOf(thread.id)`），不再读 data.isCreatorWindow flag。
 *
 * 纯函数：不改 window / thread，仅返回投影 class。
 */

import type { BaseContextWindow } from "../_shared/types/context-window.js";
import { isCreatorWindowId } from "../_shared/types/context-window.js";
import { isSuperSessionId } from "@ooc/core/_shared/types/constants.js";
import type { ThreadContext } from "../thinkable/context.js";

/** talk-family 投影 class 的取值域。 */
export type ProjectionClass = "talk" | "reflect_request" | "thread";

export function computeProjectionClass(
  window: Pick<BaseContextWindow, "id">,
  thread: ThreadContext,
): ProjectionClass {
  // self-view（creator 窗）：thread 与其 creator 的对话面。creator 窗身份由 id 派生
  // （isCreatorWindowId，不再读 data.isCreatorWindow flag）。super flow 取 reflect_request
  // （反思自视，额外挂沉淀 method），否则取 thread。fork creator 窗（同对象父子）也是 self-view。
  if (isCreatorWindowId(window.id)) {
    return isSuperSessionId(thread.persistence?.sessionId ?? "") ? "reflect_request" : "thread";
  }
  // other-view（peer/sub 会话窗，含父侧 fork 子窗）：与对端 thread 的对话 → talk。
  return "talk";
}
