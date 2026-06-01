import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";

/**
 * Root window — 每个 thread 隐含一个，固定 id="root"，title=thread 自身的标题。
 *
 * 不可被 LLM 显式 open / close。注册的 command 集合 = 今天 src/executable/commands 目录全集。
 */
export interface RootWindow extends BaseContextWindow {
  type: "root";
  status: "active";
}
