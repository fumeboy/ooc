/**
 * file —— 文件窗 class 的 **object data**（types.ts = 纯 Data）。
 *
 * 只含业务字段；**不含**窗的元信息字段（id/class/title/status/createdAt/parentWindowId）——那些由 runtime
 * 管理。展示态（viewport / lines / columns）也不在此，归 readable 的投影态 `win`（见 readable/index.ts
 * 的 `FileWin`）。
 *
 * - path：文件绝对路径或工作目录相对路径
 */
export interface Data {
  path: string;
}
