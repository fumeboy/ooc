import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";
import type { Viewport } from "@ooc/core/extendable/_shared/viewport.js";

/**
 * File window — 显示某个文件的内容（按 viewport 切片）。
 *
 * - path：文件绝对路径或工作目录相对路径
 * - 展示状态（viewport / lines / columns）现归 `state`（WindowDisplayState）：
 *   open_file 创建时填默认 viewport 0-200 / 0-200，由 readable 维度的 window method
 *   `set_viewport`（写 state.viewport）/ `set_range`（写 state.lines / state.columns）调整。
 * - 下方平铺 viewport / lines / columns 字段 **@deprecated**，仅为兼容旧 thread.json 读取。
 *
 * 详见 meta/object.doc.ts:executable.context_window.patches.viewport_protocol。
 */
export interface FileWindow extends BaseContextWindow {
  type: "file";
  status: "open" | "closed";
  path: string;
  /** @deprecated 移到 state.viewport；保留以兼容旧 thread.json。 */
  viewport?: Viewport;
  /** @deprecated 移到 state.lines；保留以兼容旧 thread.json。 */
  lines?: [number, number];
  /** @deprecated 移到 state.columns；保留以兼容旧 thread.json。 */
  columns?: [number, number];
}
