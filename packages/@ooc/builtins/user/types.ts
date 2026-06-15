/**
 * user —— 真人用户在 OOC World 内的占位 **object 实例**（不是 LLM Agent）。
 *
 * user 是单例 object（kind=object，无 class）：没有业务字段，纯占位。Data 为空。
 * 身份信封（id/class/title/status/createdAt）由 runtime 管理。
 */
export interface Data {}

/**
 * @deprecated 旧窗类型别名 —— 过渡期给前端 visible 继续编译用。
 * 新模型里 Data 与窗信封分离（信封由 runtime 管理）；此交叉类型把 Data 与可选信封
 * 字段拼回旧的「平铺窗」形状，仅供 visible 维度引用，勿在新代码使用。
 */
export type UserWindow = Data & {
  id?: string;
  class?: string;
  title?: string;
  status?: string;
  createdAt?: number;
  parentWindowId?: string;
  [key: string]: unknown;
};
