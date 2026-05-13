import type { ChatLine, ThreadContext } from "./model";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function stringifyData(value: unknown) {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return value;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value;
      }
    }
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function findInboxContent(thread: ThreadContext, msgId?: string) {
  if (!msgId) return undefined;
  return thread.inbox?.find((message) => message.id === msgId)?.content;
}

function isErrorText(text: string) {
  return text.startsWith("[错误]") || text.includes("失败") || text.includes("Error") || text.includes("error");
}

function fallbackNotice(index: number, record: Record<string, unknown>): ChatLine {
  return {
    id: `event-${index}`,
    kind: "notice",
    role: "notice",
    title: `${String(record.category ?? "event")} · ${String(record.kind ?? "unknown")}`,
    content: stringifyData(record) ?? "(empty event)",
    tone: "info",
  };
}

export function formatThread(thread?: ThreadContext): ChatLine[] {
  if (!thread) return [];
  const lines: ChatLine[] = [];
  const events = thread.events ?? [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!isRecord(event)) continue;

    const category = typeof event.category === "string" ? event.category : undefined;
    const kind = typeof event.kind === "string" ? event.kind : undefined;

    if (category === "context_change" && kind === "inbox_message_arrived") {
      const content = findInboxContent(thread, typeof event.msgId === "string" ? event.msgId : undefined);
      if (content) {
        lines.push({
          id: typeof event.msgId === "string" ? event.msgId : `event-${index}`,
          kind: "message",
          role: "user",
          content,
        });
      }
      continue;
    }

    if (category === "llm_interaction" && kind === "text" && typeof event.text === "string") {
      lines.push({ id: `event-${index}`, kind: "message", role: "assistant", content: event.text });
      continue;
    }

    if (category === "context_change" && kind === "inject" && typeof event.text === "string") {
      lines.push({
        id: `event-${index}`,
        kind: "notice",
        role: "notice",
        title: "Context update",
        content: event.text,
        tone: isErrorText(event.text) ? "error" : "info",
      });
      continue;
    }

    if (category === "llm_interaction" && kind === "function_call") {
      const nextEvent = events[index + 1];
      const nextRecord = isRecord(nextEvent) ? nextEvent : undefined;
      const mergedOutput =
        nextRecord?.category === "tool_runtime" &&
        nextRecord?.kind === "function_call_output" &&
        typeof nextRecord.callId === "string" &&
        typeof event.callId === "string" &&
        nextRecord.callId === event.callId
          ? nextRecord
          : undefined;

      lines.push({
        id: typeof event.callId === "string" ? event.callId : `event-${index}`,
        kind: "tool",
        role: "tool",
        toolName: typeof event.toolName === "string" ? event.toolName : "tool",
        callId: typeof event.callId === "string" ? event.callId : undefined,
        argumentsText: stringifyData(event.arguments),
        outputText: mergedOutput ? stringifyData(mergedOutput.output) : undefined,
        ok: mergedOutput ? Boolean(mergedOutput.ok) : undefined,
        pending: !mergedOutput,
      });
      if (mergedOutput) index += 1;
      continue;
    }

    if (category === "tool_runtime" && kind === "function_call_output") {
      lines.push({
        id: typeof event.callId === "string" ? `${event.callId}-output` : `event-${index}`,
        kind: "tool",
        role: "tool",
        toolName: typeof event.toolName === "string" ? event.toolName : "tool",
        callId: typeof event.callId === "string" ? event.callId : undefined,
        outputText: stringifyData(event.output),
        ok: typeof event.ok === "boolean" ? event.ok : undefined,
      });
      continue;
    }

    if (category === "llm_interaction" && kind === "tool_use") {
      lines.push({
        id: `event-${index}`,
        kind: "tool",
        role: "tool",
        toolName: typeof event.toolName === "string" ? event.toolName : "tool",
        argumentsText: stringifyData(event.arguments),
        pending: true,
      });
      continue;
    }

    if (category === "llm_interaction" && kind === "thinking" && typeof event.text === "string") {
      lines.push({
        id: `event-${index}`,
        kind: "notice",
        role: "notice",
        title: "Thinking",
        content: event.text,
        tone: "warning",
      });
      continue;
    }

    lines.push(fallbackNotice(index, event));
  }

  return lines;
}
