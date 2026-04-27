import type { ThreadStatus } from "./types.js";

/** 执行结果 */
export interface TalkResult {
  /** Session ID */
  sessionId: string;
  /** Root 线程最终状态 */
  status: ThreadStatus;
  /** Root 线程摘要 */
  summary?: string;
  /** 总迭代次数 */
  totalIterations: number;
  /** 实际执行的线程 ID（用于 talk(context="continue")） */
  threadId?: string;
  /** 失败原因（仅 status === "failed" 时填充） */
  failureReason?: string;
}

/**
 * world.talk() / resumeFlow() / stepOnce() 的统一返回类型
 *
 * 替代直接返回 Flow 实例：线程树架构下 Flow 类不再作为返回契约，
 * 而是以一个纯数据对象暴露外部消费者需要的字段。
 *
 * 调用方只需读取 sessionId/status/messages/actions/summary，
 * 与 Flow.toJSON() 的结构保持一致，由 writeSessionArtifact 落盘到 data.json。
 */
export interface TalkReturn {
  /** 会话 ID（即 mainFlow/rootThread 的 sessionId） */
  sessionId: string;
  /** 最终状态（按 FlowStatus 枚举：running/waiting/pausing/finished/failed） */
  status: "running" | "waiting" | "pausing" | "finished" | "failed";
  /** 消息列表（与 FlowMessage 同形） */
  messages: Array<{ direction: "in" | "out"; from: string; to: string; content: string; timestamp: number; id?: string }>;
  /** 行为树动作（扁平列表，来自线程树 actions 的投影） */
  actions: Array<{ type: string; content: string; timestamp: number; id?: string; result?: string; success?: boolean }>;
  /** 对话摘要 */
  summary?: string;
  /** 关联的底层线程 ID（用于 talk(context="continue")） */
  threadId?: string;
  /** toJSON 快照（供 HTTP 调试/前端消费，形态与 Flow.toJSON 兼容） */
  toJSON?: () => Record<string, unknown>;
}


export function threadStatusToFlowStatus(status: ThreadStatus): TalkReturn["status"] {
  return status === "done" ? "finished"
    : status === "failed" ? "failed"
    : status === "paused" ? "pausing"
    : status === "running" ? "running"
    : "waiting";
}
