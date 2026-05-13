import type { ChatLine, ThreadContext } from "./model";

function eventText(event: unknown) {
  if (!event || typeof event !== "object") return undefined;
  const record = event as Record<string, unknown>;
  for (const key of ["text", "content", "message", "output"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  if (record.kind || record.category) return JSON.stringify(record, null, 2);
  return undefined;
}

export function formatThread(thread?: ThreadContext): ChatLine[] {
  if (!thread) return [];
  const userLines = (thread.inbox ?? []).map((msg, index) => ({
    id: msg.id ?? `inbox-${index}`,
    role: "user" as const,
    content: msg.content ?? JSON.stringify(msg, null, 2),
  }));
  const eventLines: ChatLine[] = [];
  for (const [index, event] of (thread.events ?? []).entries()) {
    const content = eventText(event);
    if (content) eventLines.push({ id: `event-${index}`, role: "action", content });
  }
  return [...userLines, ...eventLines];
}
