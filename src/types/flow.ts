/**
 * Flow 相关类型定义 (G2, G10)
 *
 * Flow 是 Stone 在执行任务时的动态派生。
 * 拥有思考能力、执行能力、状态机、消息记录。
 *
 * @ref docs/哲学文档/gene.md#G2 — implements — Flow 动态形态（FlowData, FlowStatus）
 * @ref docs/哲学文档/gene.md#G8 — implements — PendingMessage 异步消息投递
 * @ref docs/哲学文档/gene.md#G10 — implements — Action 不可变事件记录
 * @ref src/types/process.ts — references — Process 行为树类型
 */

/** Flow 状态机 (G2) */
export type FlowStatus = "running" | "waiting" | "pausing" | "finished" | "failed";

/** 事件类型 (G10) */
export type ActionType = "thought" | "program" | "message_in" | "message_out" | "pause" | "inject";

/** 不可变事件记录 (G10) */
export interface Action {
  /** 唯一 ID */
  id?: string;
  /** 事件类型 */
  type: ActionType;
  /** 时间戳 */
  timestamp: number;
  /** 内容 */
  content: string;
  /** 执行结果（仅 program 类型） */
  result?: string;
  /** 是否成功（仅 program 类型） */
  success?: boolean;
}

/** 消息方向 */
export type MessageDirection = "in" | "out";

/** Flow 消息记录 */
export interface FlowMessage {
  /** 唯一 ID */
  id?: string;
  /** 消息方向 */
  direction: MessageDirection;
  /** 发送者 */
  from: string;
  /** 接收者 */
  to: string;
  /** 消息内容 */
  content: string;
  /** 时间戳 */
  timestamp: number;
}

import type { Process } from "./process.js";

/** 待处理消息（异步投递，等待下一轮注入） */
export interface PendingMessage {
  /** 唯一 ID */
  id: string;
  /** 发送者 */
  from: string;
  /** 消息内容 */
  content: string;
  /** 回复哪条消息的 ID（用于关联 talk 请求-响应） */
  replyTo?: string;
  /** 时间戳 */
  timestamp: number;
}

/** Flow 的完整数据结构 (G2) */
export interface FlowData {
  /** 任务 ID */
  taskId: string;
  /** 所属 Stone 名称 */
  stoneName: string;
  /** 用户自定义标题 */
  title?: string;
  /** 当前状态 */
  status: FlowStatus;
  /** 消息列表 */
  messages: FlowMessage[];
  /** 行为树（所有 action 存储在节点上） */
  process: Process;
  /** Flow 局部数据 */
  data: Record<string, unknown>;
  /** 待处理消息队列（异步投递） */
  pendingMessages?: PendingMessage[];
  /** 当前等待回复的消息 ID（talk 发出后等待对方回复） */
  waitingForReply?: string;
  /** 触发此 Flow 的对象名（sub-flow 场景，用于错误传播） */
  initiatedBy?: string;
  /** 创建时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 会话级记忆索引（memory.md 内容） */
  memory?: string;
  /** Flow 摘要（对象自主更新，用于跨 flow 记忆） */
  summary?: string;
  /** 是否为 SelfMeta Flow（拥有写 Self 目录的特权） */
  isSelfMeta?: boolean;
}
