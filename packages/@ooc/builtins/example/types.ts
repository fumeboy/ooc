import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";

/**
 * example_window —— 标准对象定义的最小样板窗口。
 *
 * 业务数据（executable 维度的 object method 读写）：
 * - message：要展示的文本（可多行）
 * - bumpCount：被 `bump` method 累加的次数
 *
 * 展示状态（readable 维度的 window method 读写）归 `state.viewport`（行/列视口），
 * 与业务数据物理分离——与 file_window 同构。
 */
export interface ExampleWindow extends BaseContextWindow {
  class: "example";
  status: "open" | "closed";
  message: string;
  bumpCount: number;
}
