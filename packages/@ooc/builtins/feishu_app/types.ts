/**
 * feishu_app —— object data 结构（OocClass 契约的 `types.ts` = 纯业务数据）。
 *
 * feishu_app 是飞书应用接入点的**单例 object**：持飞书集成的运行态、开 feishu_chat / feishu_doc
 * 子对象、把飞书消息双向转发到 OOC session。它继承 agent（agency：talk/plan/todo/end）。
 *
 * 凭证不在此硬编码——所有飞书调用走 lark-cli（鉴权自管）+ event-relay 从 .world.json
 * 读 LarkAppId/LarkAppSecret。本 Data 只承载非敏感的运行态。
 */
export interface Data {
  /** 已通过本接入点开过的 feishu_chat 子对象 id（运行期记录，便于 readable 投影列出）。 */
  openedChatObjectIds?: string[];
  /** 已通过本接入点开过的 feishu_doc 子对象 id。 */
  openedDocObjectIds?: string[];
}
