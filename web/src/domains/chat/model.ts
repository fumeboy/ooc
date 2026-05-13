export type ThreadContext = {
  id: string;
  status?: string;
  inbox?: Array<{ id?: string; content?: string; createdAt?: number }>;
  events?: unknown[];
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
