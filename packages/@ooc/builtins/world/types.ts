import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";

/**
 * World window —— world 成员对象在 context 里的窗形态。
 *
 * world 是 agent 组合持有的 **tool-object 成员**（非 Agent）：它承载**系统机制级**操作——
 * create_object（把新对象骨架落 session worktree），后续 governance / 类管理也归此。
 * 区别于 filesystem（字节级文件）：world 操作的是「对象世界」语义（注册/类链/沉淀）。
 */
export interface WorldWindow extends BaseContextWindow {
  class: "world";
  status: "open" | "closed";
}
