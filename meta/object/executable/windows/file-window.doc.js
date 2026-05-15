import * as file from "@src/executable/windows/file";

/**
 * file_window 概念：把文件正文按 lines/columns 切片引入 context。
 *
 * sources:
 *  - file — set_range / reload / close 命令注册 + 文件读取与切片
 */
export const file_window_v20260515_1 = {
  name: "FileWindow",
  description: `
file_window 把指定文件的正文（按可选的 lines / columns 切片）作为持久 window 引入 context。
由 root.open_file 在 args 给齐 path 时 open 立即提交 form 直建。

注册的 command：
- set_range — 调整 lines/columns 切片范围
- reload    — 重新读取文件正文（文件被外部修改时刷新）
- close     — 释放该 window
`.trim(),
  sources: { file },
};
