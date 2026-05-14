export type ThreadContext = {
  id: string;
  status?: string;
  inbox?: Array<{ id?: string; content?: string; createdAt?: number }>;
  events?: unknown[];
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
