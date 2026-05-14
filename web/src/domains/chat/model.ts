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
  content?: string;
  createdAt?: number;
  source?: string;
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
  inbox?: ThreadMessage[];
  outbox?: ThreadMessage[];
  events?: unknown[];
  /** ContextWindow 集合；老 thread.json 可能不带，所以 optional。 */
  contextWindows?: ContextWindow[];
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
