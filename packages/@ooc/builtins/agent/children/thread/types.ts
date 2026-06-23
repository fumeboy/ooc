import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type {
  ProcessEvent,
  ThreadStatus,
} from "@ooc/core/_shared/types/thread.js";
import type { TranscriptViewport } from "./readable/transcript-viewport";
import type { SummarizedRange } from "@ooc/core/_shared/utils/summarized-ranges.js";

/** 线程之间通过 inbox/outbox 传递的最小消息模型。 */
export type ThreadMessage = {
  /** 消息唯一标识；当前由创建方生成，不要求全局可排序。 */
  id: string;
  /** 消息正文，直接作为接收线程可见的协作输入。 */
  content: string;
  /** 创建时间戳，用于排序和调试，不承担强一致时钟语义。 */
  createdAt: number;
  from: "caller" | "callee";
};

/**
 * 单个线程的运行时上下文 **+ 会话窗指针字段** —— thread class 的统一业务 data。
 * 不记录 caller 信息
 */
export type ThreadContext = {
  sessionId: string;
  calleeObjectId: string
  /** 线程唯一标识；同时用于 XML context 中的 thread id。 */
  id: string;
  /** 调度状态；status="waiting" 表示等待 inbox 新消息，不再有 waitingType 细分。 */
  status: ThreadStatus;
  /** 当前线程的过程事件流，会被转换成 system message 之后的普通 LLM messages。 */
  events: ProcessEvent[];

  messages: ThreadMessage[];

  /**
   * 当前线程持有的 object 实例引用（Wave 4：元素类型从旧平铺 `ContextWindow` 改为
   * `OocObjectRef` —— 身份元信息 + 投影态 win；**窗不持 data**，data 在 session 对象表 / data.json）。
   */
  contextWindows: OocObjectRef[];
  /** end method 写入的结束原因。 */
  endReason?: string;
  /** end method 写入的最终摘要。 */
  endSummary?: string;
  /**
   * 结构化失败原因。
   *
   * 当 status="failed" 由 thinkloop catch 块写入时，给出机读的失败分类，让控制面 /
   * GET .../threads/:id 不必去 events 里扒文本：
   * - "llm_timeout"：LlmTimeoutError（LLM 调用超时兜底触发）
   * - "think_error"：think 单轮中其他异常
   *
   * 仅失败终态写入；done/running/waiting/paused 不带此字段。
   */
  statusReason?: string;
  /** 失败时的人读错误消息（与 statusReason 配套）。 */
  lastError?: string;
  /**
   * 任务级 LLM 超时覆盖（ms）。
   *
   * 缺省时 think → llmClient.generate 回落全局默认（120s，由 OOC_LLM_TIMEOUT_MS 覆写）。
   * 设置后本 thread 的每轮 generate 用此值兜底超时，让"已知慢任务"能申请更长超时，
   * 而不必全局拔高（全局拔高会让真卡死 thread 拖更久才暴露，反伤 observability）。
   */
  llmTimeoutMs?: number;
  /** 最近一次被 scheduler 执行的时间，用于公平选择下一个 running thread。 */
  lastExecutedAt?: number;

  // ─────────────── 会话窗指针字段（旧 `interface Data` 合并入；全 optional）───────────────
  /** true ⇒ fork 子线程窗（同对象，旧 do_window）；缺省 ⇒ peer 跨对象会话窗。 */
  isForkWindow?: boolean;
};

export type Data = ThreadContext;

export interface ThreadWin {
  transcriptViewport?: TranscriptViewport;
  summarizedRanges?: SummarizedRange[];
  autoCompressLevel?: 0 | 1 | 2;
}
