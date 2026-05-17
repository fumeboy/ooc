import type { ChatLine, ThreadContext, ToolMark, ToolSummaryField } from "./model";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function stringifyData(value: unknown) {
  if (value == null) return undefined;
  const parsed = parseStructuredValue(value);
  if (typeof parsed === "string") return parsed;
  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(parsed);
  }
}

function asDisplayText(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return stringifyData(value);
}

function extractMarks(argumentsValue: unknown): ToolMark[] | undefined {
  if (!isRecord(argumentsValue)) return undefined;
  const raw = Array.isArray(argumentsValue.mark)
    ? argumentsValue.mark
    : Array.isArray(argumentsValue.marks)
      ? argumentsValue.marks
      : undefined;
  if (!raw?.length) return undefined;
  return raw
    .filter(isRecord)
    .map((entry) => ({
      messageId: typeof entry.messageId === "string" ? entry.messageId : undefined,
      type: typeof entry.type === "string" ? entry.type : undefined,
      tip: typeof entry.tip === "string" ? entry.tip : undefined,
    }));
}

function buildRefineSummaryFields(argumentsValue: Record<string, unknown>): ToolSummaryField[] {
  const fields: ToolSummaryField[] = [];
  const formId = asDisplayText(argumentsValue.form_id);
  if (formId) fields.push({ label: "form", value: formId });
  const formArgs = isRecord(argumentsValue.form_args)
    ? argumentsValue.form_args
    : isRecord(argumentsValue.args)
      ? argumentsValue.args
      : undefined;
  if (!formArgs) return fields;
  for (const [key, value] of Object.entries(formArgs)) {
    const text = asDisplayText(value);
    if (text) fields.push({ label: key, value: text });
  }
  return fields;
}

function buildToolSummaryFields(toolName: string, argumentsValue: unknown): ToolSummaryField[] | undefined {
  if (!isRecord(argumentsValue)) return undefined;
  const fields: ToolSummaryField[] = [];
  if (toolName === "open") {
    // ContextWindow 协议（spec 2026-05-14）：parent_window_id + command + args
    const parent = asDisplayText(argumentsValue.parent_window_id);
    if (parent) fields.push({ label: "parent", value: parent });
    const command = asDisplayText(argumentsValue.command);
    if (command) fields.push({ label: "command", value: command });
    if (isRecord(argumentsValue.args)) {
      for (const [k, v] of Object.entries(argumentsValue.args)) {
        const text = asDisplayText(v);
        if (text) fields.push({ label: k, value: text });
      }
    }
  }
  if (toolName === "refine") {
    fields.push(...buildRefineSummaryFields(argumentsValue));
  }
  if (toolName === "submit") {
    const formId = asDisplayText(argumentsValue.form_id);
    if (formId) fields.push({ label: "form", value: formId });
  }
  if (toolName === "close") {
    // close 在新模型下用 window_id；保留 form_id 兼容旧调用习惯
    const windowId = asDisplayText(argumentsValue.window_id) ?? asDisplayText(argumentsValue.form_id);
    if (windowId) fields.push({ label: "window", value: windowId });
  }
  if (toolName === "wait") {
    return undefined;
  }
  return fields.length ? fields : undefined;
}

function buildToolHeaderDescription(toolName: string, argumentsValue: unknown): string | undefined {
  if (!isRecord(argumentsValue)) return undefined;
  if (toolName === "open") {
    return asDisplayText(argumentsValue.description);
  }
  if (toolName === "wait" || toolName === "close") {
    return asDisplayText(argumentsValue.reason);
  }
  return undefined;
}

function buildToolLine(input: {
  id: string;
  toolName: string;
  callId?: string;
  argumentsValue?: unknown;
  outputValue?: unknown;
  ok?: boolean;
  pending?: boolean;
}): ChatLine {
  const title = isRecord(input.argumentsValue) && typeof input.argumentsValue.title === "string"
    ? input.argumentsValue.title
    : undefined;
  return {
    id: input.id,
    kind: "tool",
    role: "tool",
    toolName: input.toolName,
    callId: input.callId,
    title,
    headerDescription: buildToolHeaderDescription(input.toolName, input.argumentsValue),
    summaryFields: buildToolSummaryFields(input.toolName, input.argumentsValue),
    marks: extractMarks(input.argumentsValue),
    rawArguments: input.argumentsValue,
    rawOutput: input.outputValue,
    argumentsText: stringifyData(input.argumentsValue),
    outputText: stringifyData(input.outputValue),
    ok: input.ok,
    pending: input.pending,
  };
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

  // 预扫描所有 function_call_output 并按 callId 建索引，让 function_call 能
  // 跨距离配对其 output（LLM 一次抛多个并行 tool_call 时，输出不会紧跟在调用之后）。
  // 同一 callId 出现多次时取首条；被消费过的 output index 标记跳过，避免渲染孤儿卡。
  const outputsByCallId = new Map<string, { event: Record<string, unknown>; index: number }>();
  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    if (!isRecord(ev)) continue;
    if (ev.category === "tool_runtime" && ev.kind === "function_call_output" && typeof ev.callId === "string") {
      if (!outputsByCallId.has(ev.callId)) outputsByCallId.set(ev.callId, { event: ev, index: i });
    }
  }
  const consumedOutputIndices = new Set<number>();

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
      const callId = typeof event.callId === "string" ? event.callId : undefined;
      const matched = callId ? outputsByCallId.get(callId) : undefined;
      if (matched) consumedOutputIndices.add(matched.index);

      lines.push(buildToolLine({
        id: callId ?? `event-${index}`,
        toolName: typeof event.toolName === "string" ? event.toolName : "tool",
        callId,
        argumentsValue: event.arguments,
        outputValue: matched?.event.output,
        ok: matched ? Boolean(matched.event.ok) : undefined,
        pending: !matched,
      }));
      continue;
    }

    if (category === "tool_runtime" && kind === "function_call_output") {
      // 已被某个 function_call 通过 callId 索引消费过 → 跳过，避免渲染空的孤儿卡。
      if (consumedOutputIndices.has(index)) continue;
      lines.push(buildToolLine({
        id: typeof event.callId === "string" ? `${event.callId}-output` : `event-${index}`,
        toolName: typeof event.toolName === "string" ? event.toolName : "tool",
        callId: typeof event.callId === "string" ? event.callId : undefined,
        outputValue: event.output,
        ok: typeof event.ok === "boolean" ? event.ok : undefined,
      }));
      continue;
    }

    if (category === "llm_interaction" && kind === "tool_use") {
      lines.push(buildToolLine({
        id: `event-${index}`,
        toolName: typeof event.toolName === "string" ? event.toolName : "tool",
        argumentsValue: event.arguments,
        pending: true,
      }));
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
