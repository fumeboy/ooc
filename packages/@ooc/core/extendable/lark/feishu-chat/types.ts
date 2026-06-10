import type { BaseContextWindow } from "../../../executable/windows/_shared/types.js";

/**
 * Feishu chat window — 在 context 中以飞书群聊 / 单聊为对象单元的窗口。
 *
 * 设计要点（meta/case.feishu-integration.doc.ts）：
 * - 一个 chat_id 对应一个 window 实例；多次 open 同 chat 应复用 window。
 * - 渐进式 buffer：默认 mode="tail" 拉取最近 N 条；search 模式临时切换。
 * - 写类方法（send/reply）严格走 dry-run gate；form 流程见 method.send / method.reply。
 *
 * 字段：
 * - chatId：飞书 chat_id（oc_xxx）。
 * - chatName：群名 / 单聊对方姓名（refresh 时更新；可能落后于飞书 rename）。
 * - chatType：群组 / 单聊 / 话题。
 * - mode：当前 buffer 语义；tail=最近 N 条，search=本群关键字搜索结果，thread=某条消息 + 回复。
 * - tailCount：mode=tail 下 buffer 应展示的条数。
 * - searchQuery：mode=search 下记录的查询词。
 * - threadAnchorMessageId：mode=thread 下定位的根消息。
 * - cursor：飞书消息分页游标（next page token）；存活窗口生命周期，不持久化到 stone。
 * - buffer：已加载的消息切片，渲染入 LLM context（按 size 截断）。
 * - subscribePollIntervalMs：≥0 时表示窗口希望被周期性 refresh；当前阶段仅作为元数据，
 *   实际 poller 集成见 case 文档 §future。
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

export interface FeishuChatWindow extends BaseContextWindow {
  class: "feishu_chat";
  status: "open" | "closed";
  chatId: string;
  chatName: string;
  chatType?: "group" | "p2p" | "topic";
  mode: "tail" | "search" | "thread";
  tailCount?: number;
  searchQuery?: string;
  threadAnchorMessageId?: string;
  cursor?: string;
  buffer: FeishuChatMessage[];
  subscribePollIntervalMs?: number;
  /** 末次 refresh 时间（毫秒）；用于 render 显示陈旧度。 */
  lastRefreshAtMs?: number;
}
