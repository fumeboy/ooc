import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";

/**
 * Interpreter window —— interpreter 成员对象在 context 里的窗形态。
 *
 * interpreter 是 agent 组合持有的 **tool-object 成员**（非 Agent）：它把「跑 ts/js 脚本」收成
 * 方法（run），调它造出 interpreter_process（ts/js sandbox + history）。窗本身只承载身份 + 方法面。
 */
export interface InterpreterWindow extends BaseContextWindow {
  class: "interpreter";
  status: "open" | "closed";
}
