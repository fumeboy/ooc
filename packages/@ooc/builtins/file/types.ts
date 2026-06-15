/**
 * file —— 文件窗 class 的 **object data**（types.ts = 纯 Data）。
 *
 * 只含业务字段；**不含**窗信封字段（id/class/title/status/createdAt/parentWindowId）——那些由 runtime
 * 管理。展示态（viewport / lines / columns）也不在此，归 readable 的投影态 `win`（见 readable/index.ts
 * 的 `FileWin`）。
 *
 * - path：文件绝对路径或工作目录相对路径
 */
export interface Data {
  path: string;
}

/**
 * @deprecated 过渡兼容别名 —— 仅为让 `visible/` 旧组件继续编译（它读 window.path / window.state /
 * window.lines / window.columns 等平铺/信封字段）。新代码用 `Data` + runtime 信封 + `FileWin` 投影态；
 * core 反推完成后删除。
 */
export type FileWindow = Data & {
  id?: string;
  class?: string;
  title?: string;
  status?: string;
  createdAt?: number;
  parentWindowId?: string;
  lines?: [number, number];
  columns?: [number, number];
  state?: {
    viewport?: unknown;
    lines?: [number, number];
    columns?: [number, number];
  };
};
