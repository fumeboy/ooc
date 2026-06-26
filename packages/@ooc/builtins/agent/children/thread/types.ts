import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type { TranscriptViewport } from "./readable/transcript-viewport";
import type { SummarizedRange } from "@ooc/core/utils/summarized-ranges.js";

/**
 * ProcessEvent 共享的可选字段;所有 variants 都可承载它们。
 *
 * - `id`: 事件稳定标识(可选)。旧 thread.json 无 id 字段属正常,渲染层按数组下标 fallback。
 *
 * 注:events 折叠不再改 thread.events（旧 `_foldedBy` 标记 / `events_summary` 事件已随 compress
 * Case A 退役）——折叠态活在自己视角 thread 窗的 `win.summarizedRanges`（投影态、可逆、不动 events）。
 */
export type ProcessEventCommon = {
  /** 事件稳定标识(可选)。 */
  id?: string;
  createdAt: number;
};

/**
 * 线程过程事件。
 *
 * 只记录 ThinkLoop 单轮会直接产生或消费的事件；持久化、前端时间线和压缩策略
 * 都应围绕这个稳定事件流扩展，而不是把临时状态混入 system context。
 */
export type ProcessEvent = ProcessEventCommon & (
  | {
      /** 事件来源：LLM 本轮交互输出。 */
      category: "llm_interaction";
      /**
       * 标记本轮 think 即将真正调 LLM (写完此 event 后立即 writeThread 一次)。
       *
       * 用途: 中断 (SIGKILL / 网络挂死 / 进程重启 / LlmTimeoutError) 后, bootstrap 期
       * detectInterruptedThread 看到尾部 call_started 后无任何后续 llm_interaction 即可
       * 判定 "上一轮 LLM 没跑完", 注入一条 inject 提示让 LLM 下一 tick 看到, 不改 status,
       * 让 worker 正常重新调度。
       *
       * 详见 src/thinkable/recovery.ts。
       */
      kind: "call_started";
      /**
       * 本轮 loop 编号 (来自 beginLlmLoop 的 LlmLoopHandle.loopIndex), observability 字段;
       * recovery 检测不依赖该字段, 只看 kind = "call_started"。
       */
      loopIndex: number;
    }
  | {
      /** 事件来源：LLM 本轮交互输出。 */
      category: "llm_interaction";
      /** 普通文本回复，会作为 assistant message 进入下一轮 transcript。 */
      kind: "text";
      /** LLM 对外可见的文本内容。 */
      text: string;
    }
  | {
      /** 事件来源：LLM 本轮交互输出。 */
      category: "llm_interaction";
      /** 工具调用记录，先进入事件流，再由 executable 分派执行。 */
      kind: "tool_use";
      /** 当前文档定义的 tool 原语名称；compress 暂只保留类型位置。 */
      toolName: "exec" | "close" | "wait" | "open";
      /** 传给 tool handler 的原始参数对象。 */
      arguments: Record<string, unknown>;
    }
  | {
      /** 事件来源：LLM 本轮交互输出。 */
      category: "llm_interaction";
      /** Responses-first 一等 function_call 记录。 */
      kind: "function_call";
      /** 当前调用的稳定 ID。 */
      callId: string;
      /** 被调用的 OOC tool 名称。 */
      toolName: "exec" | "close" | "wait" | "open";
      /** 传给 tool handler 的原始参数对象。 */
      arguments: Record<string, unknown>;
    }
  | {
      /** 事件来源：LLM 本轮交互输出。 */
      category: "llm_interaction";
      /** thinking 只用于记录回看，不作为推理上下文复喂。 */
      kind: "thinking";
      /** provider 返回的 thinking 文本。 */
      text: string;
    }
  | {
      /** 事件来源：系统、工具或外部输入导致的上下文变化。 */
      category: "context_change";
      /** 注入给下一轮 LLM 的提示，通常用于错误、状态变化或人工补充。 */
      kind: "inject";
      /** 注入内容，会以 user message 形式进入下一轮 transcript。 */
      text: string;
      /**
       * 可选：触发该注入的源头模块 / 函数（如 "thinkable/llm/providers/openai#toOpenAiOutputItems"）。
       * 用于可观测性：thread.json 查看者 / 控制面能直接定位事件是谁发出的，
       * 而不必从错误文本反推。错误类注入强烈建议填充。
       */
      source?: string;
      /**
       * 可选：机器可读的错误码，供上层按类型处理（如 "json_parse_failed"、
       * "tool_dispatch_error"、"permission_denied"）。
       */
      errorCode?: string;
      /**
       * 可选：完整或截断的原始异常堆栈。仅在 source 是异常捕获点时填充；
       * 前端 timeline 默认折叠，不直接注入 LLM context。
       */
      stack?: string;
      /**
       * 可选：相关数据的预览（截断到 ≤ 200 字符）。
       * 例如 JSON.parse 失败时放入被解析的原始字符串前 200 字，极大降低定位成本。
       */
      dataPreview?: string;
    }
  | {
      /** 事件来源：外部输入到达，供 context builder 关联 inbox 中的新消息。 */
      category: "context_change";
      /** inbox 中有新消息到达。 */
      kind: "inbox_message_arrived";
      /** 到达消息的稳定标识。 */
      msgId: string;
      /** 可选的附加提示文本。 */
      text?: string;
    }
  | {
      /** 事件来源：tool 运行时结果。 */
      category: "tool_runtime";
      /** function_call 的输出结果。 */
      kind: "function_call_output";
      /** 与 function_call 对应的调用 ID。 */
      callId: string;
      /** 对应的 tool 名称。 */
      toolName: "exec" | "close" | "wait" | "open";
      /** 序列化后的输出字符串。 */
      output: string;
      /** 是否成功。 */
      ok: boolean;
    }
  | {
      /**
       * 事件来源：context 折叠发生（compress v2）。
       *
       * 由 `harvestSummarizerForks` 在 summarizer fork 完成（done→记段 / failed→关自动压缩）时写一条，
       * 与现有 ProcessEvent 同序进 thread.json / debug 落盘 / contextSnapshot,LLM 视野中也可见
       * （silent-swallow ban：折叠对 LLM 透明）。
       */
      category: "context_change";
      /** 折叠发生:每次 harvest 记段 / 记失败写一条。 */
      kind: "context_compressed";
      /** 折叠标记,形如 "auto-fold" / "auto-fold-failed"。 */
      levelChange: string;
      /** 触发原因:auto-summarized / summarizer-fork-failed 等。 */
      reason: string;
    }
  | {
      /**
       * 事件来源：runJob 单次跑满 workerMaxTicks 自然返回，且 thread.status 仍为 running。
       *
       * worker 出口在写完本事件后
       * 调 jobManager.createRunThreadJob 让自己再入队一次，让长任务跨 job 续跑。
       * LLM 下轮可见，区别于自然 done / paused / failed。
       */
      category: "context_change";
      kind: "scheduler_yielded";
      /** 触发原因：当前只有 max_ticks，未来可扩展（如 cooperative_yield）。 */
      reason: "max_ticks";
      /** 触发时已跑过的 LLM 轮数（call_started 计数），observability。 */
      rounds?: number;
    }
  | {
      /**
       * 事件来源: thinkloop 在 dispatchToolCall 之前调 decidePermission 返回 "ask"。
       *
       * 写完事件后 thread.status="paused"。
       * HTTP endpoint 写入 decided 字段 + 翻回 running; thinkloop 在 resume 路径
       * 扫"最近一条 permission_ask"按 decided.action 处理:
       *        approve → 用 pendingCall 字段重放该 tool call (绕过 decidePermission)
       *        reject  → 写 permission_denied + 合成 function_call_output
       *
       * 渲染层根据 decided 区分 pending / approved / rejected 三态 system message。
       */
      category: "permission";
      kind: "permission_ask";
      /** 触发本次 ask 的 function_call id (与 llm_interaction.function_call.callId 对齐)。 */
      toolCallId: string;
      /** 解析后的实际 method 路径 (例如 "talk", "write_file" 或 "exec" / "close" 等 tool 名)。 */
      method: string;
      /** args 摘要 (截断到 200 字以内, 防止 events 流爆炸)。 */
      argsSummary?: string;
      /** exec 时目标 window id。 */
      windowId?: string;
      /**
       * HITL 审批决议。无 → 待审批; "approve" → 已批准 (thinkloop resume 时重放);
       * "reject" → 已拒绝 (thinkloop resume 时合成 denied + function_call_output)。
       */
      decided?: {
        action: "approve" | "reject";
        at: number;
        reason?: string;
      };
      /**
       * 完整序列化的原 pending tool call。approve 路径用它直接 dispatchToolCall,
       * 不依赖 LLM 重新发起 (LLM 可能换 args 或干脆不发了)。
       *
       * 字段冗余 (toolCallId / method / windowId 已经在外层) 是为了一站式重建 LlmToolCall,
       * 避免 resume 路径再次推断。
       */
      pendingCall?: {
        toolName: "exec" | "close" | "wait" | "open";
        method: string;
        args: Record<string, unknown>;
        windowId?: string;
        toolCallId: string;
      };
    }
  | {
      /**
       * 事件来源: thinkloop 在 dispatchToolCall 之前调 decidePermission 返回 "deny"。
       *
       * Design 同 permission_ask。
       *
       * 系统已拒绝该 tool call, 并合成了一条 function_call_output (在 thread.events
       * 紧邻位置) 让 LLM 看见拒绝原因 (silent-swallow ban + Deny 信息流不变量)。
       */
      category: "permission";
      kind: "permission_denied";
      /** 被拒绝的 function_call id。 */
      toolCallId: string;
      /** 实际 method 路径。 */
      method: string;
      /** 拒绝原因 (来自 PermissionDecision.reason 或默认描述)。 */
      reason: string;
      /** args 摘要 (截断到 200 字)。 */
      argsSummary?: string;
      /** exec 时目标 window id。 */
      windowId?: string;
    }
);

/**
 * 线程调度状态。status="waiting" 表示等待 inbox 新消息（不再有 waitingType 细分）。
 * 显式提取为具名 type，便于复用。
 */
export type ThreadStatus =
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "paused";


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
};

export type Data = ThreadContext;

export interface ThreadWin {
  transcriptViewport?: TranscriptViewport;
  summarizedRanges?: SummarizedRange[];
  autoCompressLevel?: 0 | 1 | 2;
}

/**
 * 版本化字段列表（issue C 同伴常量方案 B）。
 *
 * thread 全部字段是运行时事实（messages/events/status 等），非版本化。
 */
export const VERSIONED_FIELDS: readonly (keyof Data)[] = [] as const;
