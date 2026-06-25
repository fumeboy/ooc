/**
 * feishu_app —— 飞书外接集成 tool-object。
 *
 * extendable 维度（非维度）的代表：把外部世界（飞书 IM / 文档）接入为 agent 可调用的能力。
 * 当前最小：tool-object 形态，方法为 stub（待真实接入 lark sdk 时填充）。
 */
export interface Data {
  /** App ID / Token 等连接配置（运行时注入）。 */
  appId?: string;
  /** 已连接的 chat id 列表（cache）。 */
  recentChats: string[];
}
