export type ThreadContext = {
  id: string;
  status?: string;
  inbox?: Array<{ id?: string; content?: string; createdAt?: number }>;
  events?: unknown[];
};

export type ChatLine = {
  id: string;
  role: "user" | "assistant" | "action";
  content: string;
};

