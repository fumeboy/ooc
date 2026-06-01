import type { BaseContextWindow } from "../_shared/types.js";
import type { Viewport } from "../_shared/viewport.js";

/**
 * File window — 显示某个文件的内容（按 viewport 切片）。
 *
 * - path：文件绝对路径或工作目录相对路径
 * - viewport：渲染窗口大小 { lineStart, lineEnd, columnStart, columnEnd }；
 *   open_file 创建时填默认 0-200 / 0-200，可通过 `set_viewport` 命令精细调整
 * - lines / columns：**遗留** range 切片（保留向后兼容；新代码用 viewport）
 * - 注册 command：set_viewport / set_range / reload / edit / close
 *
 * 详见 meta/object.doc.ts:executable.context_window.patches.viewport_protocol。
 */
export interface FileWindow extends BaseContextWindow {
  type: "file";
  status: "open" | "closed";
  path: string;
  viewport?: Viewport;
  /** @deprecated 用 viewport 取代。仍保留以兼容旧 thread.json。 */
  lines?: [number, number];
  /** @deprecated 用 viewport 取代。仍保留以兼容旧 thread.json。 */
  columns?: [number, number];
}
