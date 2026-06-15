/**
 * feishu_chat —— object data 结构（OocClass 契约的 `types.ts` = 纯业务数据）。
 *
 * 一个飞书群聊 / 单聊在 context 中以本对象为单元：
 * - 一个 chatId 对应一个实例；多次 open 同 chat 应复用实例。
 * - 渐进式 buffer：默认 mode="tail" 拉取最近 N 条；search 模式临时切换。
 * - 写类方法（send/reply）严格走 dry-run gate（confirm=true 才真发）。
 *
 * 不含窗信封字段（id/class/title/status/createdAt 由 runtime 管理）；投影态本类无独立 win。
 */
export interface FeishuChatMessage {
  /** 飞书 message_id（om_xxx）。 */
  messageId: string;
  /** sender open_id 或简化身份串。 */
  sender: string;
  /** 来源类型：人 / 机器人 / 系统。 */
  senderKind?: "user" | "bot" | "system";
  /** 创建时间（毫秒）。 */
  createTimeMs: number;
  /** 文本内容（其它富类型暂折叠为 [card] / [image] 占位）。 */
  text: string;
  /** 引用的父消息 id（reply 关系）。 */
  replyToMessageId?: string;
}

export interface Data {
  /** 飞书 chat_id（oc_xxx）。 */
  chatId: string;
  /** 群名 / 单聊对方姓名（refresh 时更新；可能落后于飞书 rename）。 */
  chatName: string;
  /** 群组 / 单聊 / 话题。 */
  chatType?: "group" | "p2p" | "topic";
  /** 当前 buffer 语义；tail=最近 N 条，search=本群关键字搜索，thread=某条消息 + 回复。 */
  mode: "tail" | "search" | "thread";
  /** mode=tail 下 buffer 应展示的条数。 */
  tailCount?: number;
  /** mode=search 下记录的查询词。 */
  searchQuery?: string;
  /** mode=thread 下定位的根消息。 */
  threadAnchorMessageId?: string;
  /** 飞书消息分页游标（next page token）；存活实例生命周期，不持久化到 stone。 */
  cursor?: string;
  /** 已加载的消息切片，渲染入 LLM context（按 size 截断）。 */
  buffer: FeishuChatMessage[];
  /** ≥0 时表示窗口希望被周期性 refresh；当前阶段仅作为元数据，实际 poller 集成待定。 */
  subscribePollIntervalMs?: number;
  /** 末次 refresh 时间（毫秒）；用于 render 显示陈旧度。 */
  lastRefreshAtMs?: number;
}

/**
 * @deprecated 过渡兼容别名（visible 层仍按旧「窗对象」消费）。
 * 新后端契约用 Data + runtime 信封（OocObjectInstance）。
 */
export type FeishuChatWindow = Data & {
  id?: string;
  class?: "feishu_chat";
  title?: string;
  status?: "open" | "closed";
};
