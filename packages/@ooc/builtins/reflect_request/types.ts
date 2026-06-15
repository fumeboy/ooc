/**
 * reflect_request —— object data 结构（types.ts = 纯 Data）。
 *
 * reflect_request 是 super flow 反思 thread 的 self-view（context.md core 9：取代普通 flow 的 thread
 * creator 窗）+ reflectable 沉淀方法挂载窗。它经 class 链继承 thread → talk
 * （`ooc.class: "_builtin/thread"`）的全部会话行为；自身只额外提供两个沉淀 object method。
 *
 * 与 thread 同理：会话/渲染过程数据由 runtime 管理（thread.json / thread-context.json），不冗余进业务
 * Data，故 reflect_request 的业务 Data 为空。
 */
export interface Data {}

/**
 * @deprecated 过渡别名 —— 旧 `ReflectRequestWindow`（talk 同形 super-flow self-view 窗）的窗信封视图。
 * 新契约里 Data 与窗信封（id/class/title/status/createdAt/parentWindowId）分离；旧引用仍以「窗」整体
 * 看待投影，故保留此交叉类型让其继续编译。Wave4 talk 迁移后归并删除。
 */
export type ReflectRequestWindow = Data & {
  id?: string;
  class?: "reflect_request";
  title?: string;
  status?: string;
  createdAt?: number;
  parentWindowId?: string;
  [key: string]: unknown;
};
