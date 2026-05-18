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

/** 与后端 src/executable/windows/types.ts 对齐的最小子集，仅取前端渲染所需字段。 */
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
      type: "command_exec";
      parentWindowId: string;
      title: string;
      status: "open" | "executing" | "executed";
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
      conversationId: string;
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
    }
  | {
      id: string;
      kind: "notice";
      role: "notice";
      title: string;
      content: string;
      tone?: "info" | "warning" | "error";
    };
