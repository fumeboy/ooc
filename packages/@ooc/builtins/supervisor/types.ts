/**
 * supervisor —— object data 结构（types.ts = 纯 Data）。
 *
 * supervisor 是 **kind=object**（World 中枢的唯一实例，不是 class）：继承 `_builtin/agent`
 * 拿到 agency（talk/plan/todo/end），自身**无额外业务字段**。身份/对外介绍走 self.md /
 * readable.md（静态文件，由 core readable 解析）；`status: "active"` 是对象信封态，
 * 由 runtime 管理、不在 Data 内。
 */
export interface Data {}

/**
 * @deprecated 旧窗类型别名 —— 仅供 visible 前端在对象模型迁移期继续编译。
 *
 * 对象模型下窗信封（id/class/title/status/createdAt/parentWindowId）由 runtime 管理、
 * 与 Data 分离；此交叉类型把二者拍平成旧 `SupervisorWindow` 形状的过渡门面。
 * 新代码请用 `Data` + runtime 信封，勿依赖此别名。
 */
export type SupervisorWindow = Data & {
  id?: string;
  class?: string;
  title?: string;
  status?: "active";
  createdAt?: number;
  parentWindowId?: string;
  [k: string]: unknown;
};
