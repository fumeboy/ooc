/**
 * Chat domain models — ooc-3 adaptation.
 *
 * ooc-3 ThinkThread has messages[] (LlmInputItem[]), not events[]/contextWindows[].
 * ChatLine type is preserved from ooc-2 for TuiBlock compatibility.
 */

// ---- ooc-2 ChatLine types (preserved for TuiBlock rendering compatibility) ----

export type ToolSummaryField = {
  label: string;
  value: string;
};

export type ToolMark = {
  messageId?: string;
  type?: string;
  tip?: string;
};

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
      toolCallId?: string;
      command: string;
      argsSummary?: string;
      windowId?: string;
      decided?: "approve" | "reject";
    };

// ---- ooc-3 native types ----

/** ooc-3 ThinkThread shape (matches backend src/thinkable/think-thread.ts) */
export type LlmInputItem =
  | { type: "message"; role: "system" | "user" | "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: Record<string, unknown> }
  | { type: "function_call_output"; call_id: string; name?: string; output: string }
  | { type: "reasoning"; text: string };

export type ThinkThread = {
  id: string;
  sessionId: string;
  objectUri: string;
  messages: LlmInputItem[];
  status: "running" | "done" | "failed" | "paused";
  maxTicks: number;
  ticks: number;
  llmTimeoutMs?: number;
  lastError?: string;
};

/**
 * ThreadContext — ooc-2 shape kept for interface compatibility.
 * In ooc-3 this is derived from ThinkThread.
 *
 * hash: synthetic change key (messages.length + status) for polling.
 * contextWindows: always undefined in ooc-3 (no window protocol).
 * inbox/outbox: always undefined in ooc-3.
 * events: always undefined in ooc-3 (no event stream).
 */
export type ThreadContext = {
  id: string;
  status?: string;
  /** Synthetic hash for change detection: `${ticks}:${status}:${messages.length}` */
  hash?: string;
  creatorObjectId?: string;
  /** ooc-2 compat fields — undefined in ooc-3 */
  inbox?: undefined;
  outbox?: undefined;
  events?: undefined;
  contextWindows?: undefined;
  /** ooc-3 native: full messages array */
  messages?: LlmInputItem[];
  /** raw ThinkThread for ooc-3 formatters */
  _ooc3Thread?: ThinkThread;
};

/** Convert ThinkThread to ThreadContext shape for ooc-2 component compat. */
export function threadToContext(thread: ThinkThread): ThreadContext {
  return {
    id: thread.id,
    status: thread.status,
    hash: `${thread.ticks}:${thread.status}:${thread.messages.length}`,
    messages: thread.messages,
    _ooc3Thread: thread,
  };
}
