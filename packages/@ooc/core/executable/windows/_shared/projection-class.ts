/**
 * computeProjectionClass —— talk-family（会话）窗 class 的**唯一计算入口**。
 *
 * 设计依据（context.md core 7/9）：thread-context.json 只存 object id + 展示状态、**不存 class**；
 * class 是 POV 相关的投影，每次构造/读回时由本函数从 window 形态 + thread 视角动态算。
 *
 * 两类视图（context.md core 9：self-view ≠ other-view）：
 * - **self-view（creator 窗，isCreatorWindow）= thread 自己与其 creator 的对话**：
 *     super flow（sessionId="super"）取 "reflect_request"（thread 的反思自视，额外挂沉淀 method），
 *     否则取 "thread"。fork 子窗（同对象父子）的 creator 窗也是 self-view → 同走此分支取 "thread"。
 * - **other-view（peer/sub 会话窗，非 creator，含父侧 fork 子窗）= 与对端 thread 的对话** → "talk"。
 *
 * 即 isForkWindow 不再影响 class；判别只看「这条窗是不是本 thread 的 self-view（isCreatorWindow）」。
 *
 * 纯函数：不改 window / thread，仅返回投影 class。
 */

import type { BaseContextWindow } from "../../../_shared/types/context-window.js";
import { isSuperSessionId } from "@ooc/core/_shared/types/constants.js";
import type { ThreadContext } from "../../../thinkable/context.js";

/** talk-family 投影 class 的取值域。 */
export type ProjectionClass = "talk" | "reflect_request" | "thread";

/** talk-family 窗的投影 flag 子集（计算 class 只需这两个形态标记）。 */
interface ProjectableWindow {
  isForkWindow?: boolean;
  isCreatorWindow?: boolean;
}

export function computeProjectionClass(
  window: Pick<BaseContextWindow, "id"> & ProjectableWindow,
  thread: ThreadContext,
): ProjectionClass {
  // self-view（creator 窗）：thread 与其 creator 的对话面。super flow 取 reflect_request（反思自视，
  // 额外挂沉淀 method），否则取 thread。fork creator 窗（同对象父子）也是 self-view → 走此分支。
  if (window.isCreatorWindow) {
    return isSuperSessionId(thread.persistence?.sessionId ?? "") ? "reflect_request" : "thread";
  }
  // other-view（peer/sub 会话窗，含父侧 fork 子窗）：与对端 thread 的对话 → talk。
  return "talk";
}
