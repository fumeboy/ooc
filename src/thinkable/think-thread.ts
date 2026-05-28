/**
 * ThinkThread: OOC-3 最小线程上下文。
 *
 * 比 ooc-2 的 ThreadContext 轻得多——只保留 P6 harness loop 所需的字段：
 * - 身份: id / sessionId / objectUri
 * - LLM 对话历史: messages (role/content 对)
 * - 生命周期: status
 * - 配置: maxTicks / llmTimeoutMs
 *
 * 线程不持有 ContextWindow 也不持有 tool call tree；exec 结果作为 user message 追加。
 * 若未来需要 sub-thread 或 pause/permission，在此类型上扩展。
 */

import type { LlmMessage } from "./llm/types";

export type ThreadStatus =
    | "running"     // 正在 / 待调度执行
    | "done"        // LLM 调用 close tool 或 maxTicks 到达，正常结束
    | "failed"      // 抛未捕获错误或 LLM timeout
    | "paused";     // 等待 HITL 或外部恢复（P6 保留枚举值，未实装 resume 逻辑）

export interface ThinkThread {
    /** 线程唯一 id，e.g. "t_abc123". */
    id: string;
    /** 所属 session id. */
    sessionId: string;
    /** 被驱动的 Object URI, e.g. "ooc://stones/main/objects/agent_a". */
    objectUri: string;
    /** LLM 对话历史（包含 system / user / assistant 三种角色）. */
    messages: LlmMessage[];
    /** 当前生命周期状态. */
    status: ThreadStatus;
    /** 到达 maxTicks 后强制终止；0 = 无限（仅测试用）. */
    maxTicks: number;
    /** 当前已执行 tick 数. */
    ticks: number;
    /** 任务级 LLM 超时覆盖 (ms)；undefined 则使用 LlmClient 内部默认. */
    llmTimeoutMs?: number;
    /** 失败原因（仅 status=failed 时有值）. */
    lastError?: string;
}
