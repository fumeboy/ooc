/**
 * root —— object data 结构（types.ts = 纯 Data）。
 *
 * root 是一切 Object 继承链的终点（BASE 锚点），自身无业务数据字段——每个 thread 隐含一个 root
 * 投影窗（id="root"），其标题即 thread 标题，由 runtime 管理信封。
 */
export interface Data {}

/**
 * @deprecated 过渡别名 —— 旧 `RootWindow` 类型（信封字段平铺）。
 *
 * 仅供 visible 前端组件（`visible/index.tsx`）与尚未迁新契约的 core window union
 * （`executable/windows/_shared/types.ts`）继续编译。新契约下信封字段由 runtime 的
 * `OocObjectInstance` 管理、业务数据走 `Data`；core 反推阶段移除此别名。
 */
export type RootWindow = Data & {
  id?: string;
  class?: "root";
  title?: string;
  status?: string;
  createdAt?: number;
  parentWindowId?: string;
  [key: string]: unknown;
};
