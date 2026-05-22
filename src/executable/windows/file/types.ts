import type { BaseContextWindow } from "../_shared/types.js";

/**
 * File window — 显示某个文件的内容（按 lines/columns 切片）。
 *
 * - path：文件绝对路径或工作目录相对路径
 * - lines / columns：可选切片范围
 * - 注册 command：set_range / reload / close
 */
export interface FileWindow extends BaseContextWindow {
  type: "file";
  status: "open" | "closed";
  path: string;
  lines?: [number, number];
  columns?: [number, number];
}
