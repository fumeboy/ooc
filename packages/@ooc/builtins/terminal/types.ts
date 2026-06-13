import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";

/**
 * Terminal window —— terminal 成员对象在 context 里的窗形态。
 *
 * terminal 是 agent 组合持有的 **tool-object 成员**（非 Agent）：它把「运行程序」收成方法
 * （program: shell/ts/js），调它造出 program 对象（执行 + history）。窗本身只承载身份 + 方法面。
 */
export interface TerminalWindow extends BaseContextWindow {
  class: "terminal";
  status: "open" | "closed";
}
