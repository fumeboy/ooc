import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";

/**
 * Runtime window —— runtime 成员对象在 context 里的窗形态。
 *
 * runtime 是 agent 组合持有的 **tool-object 成员**（非 Agent）：它向 Agent 提供**系统级接口**——
 * create_object（把新对象骨架落 session worktree），后续 governance / 类管理也归此。
 * 区别于 filesystem（字节级文件）：runtime 操作的是「对象世界」语义（注册/类链/沉淀）。
 */
export interface RuntimeWindow extends BaseContextWindow {
  class: "runtime";
  status: "open" | "closed";
}
