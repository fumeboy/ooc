/**
 * 前端 chat 模型 — 与后端 ContextWindow Step 1 (spec 2026-05-14) 对齐。
 *
 * 注意：后端 ThreadContext 的 contextWindows 是必填的；前端用 optional 是为了兼容
 * 老 thread.json 反序列化路径（虽然后端会迁移补齐 creator window，但前端不依赖）。
 */

export type ThreadMessage = {
  id?: string;
  fromThreadId?: string;
  toThreadId?: string;
  /** 跨对象 talk 时由后端写入,UI 用作 sender label。旧 thread.json 可能缺。 */
  fromObjectId?: string;
  content?: string;
  createdAt?: number;
  source?: string;
  /** outbox 中由 talk_window.say 派送时写入;用作 formatter 反查这条消息属于哪个 talk_window。 */
  windowId?: string;
  /** inbox 中由控制面 user-reply 或 talk-delivery 派送时写入;用于 transcript 视图归位。 */
  replyToWindowId?: string;
};

/** 与后端 src/executable/windows/_shared/types.ts 对齐的最小子集，仅取前端渲染所需字段。 */
export type ContextWindow =
  | {
      id: string;
      type: "root";
      title: string;
      status?: string;
      createdAt?: number;
    }
  | {
      id: string;
      type: "method_exec";
      parentWindowId: string;
      title: string;
      status: "open" | "executing" | "success" | "failed";
      command: string;
      description?: string;
      accumulatedArgs?: Record<string, unknown>;
      commandPaths?: string[];
      loadedKnowledgePaths?: string[];
      commandKnowledgePaths?: string[];
      result?: string;
      createdAt?: number;
    }
  | {
      id: string;
      type: "do";
      parentWindowId?: string;
      title: string;
      status: "running" | "archived";
      targetThreadId: string;
      isCreatorWindow?: boolean;
      createdAt?: number;
    }
  | {
      id: string;
      type: "todo";
      parentWindowId?: string;
      title: string;
      status: "open" | "done";
      content: string;
      onCommandPath?: string[];
      createdAt?: number;
    }
  | {
      id: string;
      type: "talk";
      parentWindowId?: string;
      title: string;
      status: "open" | "closed";
      target: string;
      /** 对端 thread id；首条消息派送时由 talk-delivery 回填。 */
      targetThreadId?: string;
      conversationId: string;
      isCreatorWindow?: boolean;
      createdAt?: number;
    }
  | {
      id: string;
      type: "program";
      parentWindowId?: string;
      title: string;
      status: "open" | "closed";
      history: Array<{
        execId: string;
        language: "shell" | "ts" | "js" | "function";
        code?: string;
        function?: string;
        args?: unknown;
        output: string;
        ok: boolean;
        startedAt: number;
      }>;
      createdAt?: number;
    }
  | {
      id: string;
      type: "file";
      parentWindowId?: string;
      title: string;
      status: "open" | "closed";
      path: string;
      lines?: [number, number];
      columns?: [number, number];
      createdAt?: number;
    }
  | {
      id: string;
      type: "knowledge";
      parentWindowId?: string;
      title: string;
      status: "open" | "closed";
      path: string;
      source?: "explicit" | "protocol" | "activator";
      body?: string;
      presentation?: "full" | "summary";
      description?: string;
      createdAt?: number;
    }
  | {
      id: string;
      type: "relation";
      parentWindowId?: string;
      title: string;
      status: "open" | "closed";
      /** 对端 objectId(去重 key);与 talk_window.target 同源。 */
      peerId: string;
      createdAt?: number;
    };

export type ThreadContext = {
  id: string;
  status?: string;
  /** 创建本线程的 object id；与 self objectId 比较即可判断 creator 是否=自己。 */
  creatorObjectId?: string;
  inbox?: ThreadMessage[];
  outbox?: ThreadMessage[];
  events?: unknown[];
  /** ContextWindow 集合；老 thread.json 可能不带，所以 optional。 */
  contextWindows?: ContextWindow[];
  /** 服务端对响应内容算的稳定 hash；前端 polling 用它判断内容是否变化。 */
  hash?: string;
};

export type ToolSummaryField = {
  label: string;
  value: string;
};

export type ToolMark = {
  messageId?: string;
  type?: string;
  tip?: string;
};

/**
 * 一条折叠到主 tool 卡里的"后续操作"——典型链路：
 *   open(...) → refine(parent_window_id=W) → submit(parent_window_id=W) → close(window_id=W)
 * 后三条 follow-up 都共享 window W，与首个 open 显示在同一张卡上以减少视觉噪声。
 */
export interface ToolFollowUp {
  id: string;
  toolName: string;
  callId?: string;
  title?: string;
  headerDescription?: string;
  summaryFields?: ToolSummaryField[];
  argumentsText?: string;
  outputText?: string;
  rawArguments?: unknown;
  rawOutput?: unknown;
  ok?: boolean;
  pending?: boolean;
}

export type ChatLine =
  | {
      id: string;
      kind: "message";
      role: "user" | "assistant";
      content: string;
      meta?: string;
      /** 消息发送方的展示标签,如 "user"、"supervisor:t_..."。缺省时 TuiBlock 用 role 兜底。 */
      senderLabel?: string;
    }
  | {
      id: string;
      kind: "tool";
      role: "tool";
      toolName: string;
      callId?: string;
      title?: string;
      headerDescription?: string;
      summaryFields?: ToolSummaryField[];
      marks?: ToolMark[];
      rawArguments?: unknown;
      rawOutput?: unknown;
      argumentsText?: string;
      outputText?: string;
      ok?: boolean;
      pending?: boolean;
      /**
       * 当本 tool 是 `open` 创建了一个 window，且后续紧邻（无其它 message/notice 间断）
       * 还有同一 window_id 的 refine/submit/close 调用时，把它们折叠成一组 followUp，
       * 在 UI 上以紧凑 step 行展示（共享同一张 card）。
       *
       * 与原 ChatLine 形态完全兼容：旧消费者忽略 followUps 时仍能渲染主行；
       * TuiBlock 在 tool 分支中检测 followUps 后追加 step 列表。
       */
      followUps?: ToolFollowUp[];
    }
  | {
      id: string;
      kind: "notice";
      role: "notice";
      title: string;
      content: string;
      tone?: "info" | "warning" | "error";
    }
  | {
      id: string;
      kind: "permission_card";
      role: "notice";
      /** 触发本次 ask 的 function_call id (与 backend permission_ask.toolCallId 对齐, 用于拼 eventId)。 */
      toolCallId?: string;
      command: string;
      argsSummary?: string;
      windowId?: string;
      /** 同一条 permission_ask event 的 decided 字段镜像 (backend 在 approve / reject 后回写此字段)。 */
      decided?: "approve" | "reject";
    };
