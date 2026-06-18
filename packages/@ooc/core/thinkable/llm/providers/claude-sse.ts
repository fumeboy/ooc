import type { LlmProvider, LlmToolCall } from "../types";

/**
 * SSE 解析事件 —— 仅 claude SSE-fallback 路径内部使用（generateWithClaude 在代理只回
 * text/event-stream 时聚合 parseClaudeSSE 的产出）。无对外流式 API，故类型私有于本模块。
 */
type ClaudeSseEvent =
  | { type: "start"; provider: LlmProvider; model: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolCall: LlmToolCall }
  | {
      type: "done";
      text: string;
      toolCalls: LlmToolCall[];
      raw?: unknown;
    };

/**
 * SSE 解析器。
 *
 * generateWithClaude 在"代理只返回 SSE"路径下经 collectClaudeSseResult 复用本解析器。
 * 关键点：tool 参数通过 `input_json_delta` 增量到达，必须在 content_block_stop
 * 时才能 JSON.parse 出完整对象，所以 tool-call 事件在 stop 时才 yield。
 */
export async function* parseClaudeSSE(
  body: ReadableStream<Uint8Array>,
  model: string
): AsyncGenerator<ClaudeSseEvent> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let pending = "";
  let fullText = "";
  const toolCalls: LlmToolCall[] = [];
  const toolBuffers = new Map<number, { id: string; name: string; partialJson: string }>();

  yield { type: "start", provider: "claude", model };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    pending += decoder.decode(value, { stream: true });
    const frames = pending.split("\n\n");
    pending = frames.pop() ?? "";

    for (const frame of frames) {
      const lines = frame.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event: "));
      const dataLine = lines.find((line) => line.startsWith("data: "));
      if (!eventLine || !dataLine) continue;

      const eventName = eventLine.slice(7);
      let payload: { [key: string]: unknown };
      try {
        payload = JSON.parse(dataLine.slice(6));
      } catch {
        continue;
      }

      if (
        eventName === "content_block_start" &&
        (payload.content_block as { type?: string } | undefined)?.type === "tool_use"
      ) {
        const block = payload.content_block as {
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
        };
        const input = block.input;
        if (input && typeof input === "object" && Object.keys(input).length > 0) {
          const toolCall: LlmToolCall = {
            id: block.id ?? "",
            name: (block.name ?? "wait") as LlmToolCall["name"],
            arguments: input
          };
          toolCalls.push(toolCall);
          yield { type: "tool-call", toolCall };
        } else {
          const idx = (payload.index as number) ?? toolBuffers.size;
          toolBuffers.set(idx, {
            id: block.id ?? "",
            name: block.name ?? "wait",
            partialJson: ""
          });
        }
      }

      if (eventName === "content_block_delta") {
        const delta = payload.delta as
          | { type?: string; text?: string; partial_json?: string }
          | undefined;
        if (delta?.type === "text_delta") {
          const text = delta.text ?? "";
          if (text) {
            fullText += text;
            yield { type: "text-delta", text };
          }
        } else if (delta?.type === "input_json_delta") {
          const idx = (payload.index as number) ?? -1;
          const buf = toolBuffers.get(idx);
          if (buf) buf.partialJson += delta.partial_json ?? "";
        }
      }

      if (eventName === "content_block_stop") {
        const idx = (payload.index as number) ?? -1;
        const buf = toolBuffers.get(idx);
        if (buf) {
          let args: Record<string, unknown> = {};
          if (buf.partialJson) {
            try {
              args = JSON.parse(buf.partialJson);
            } catch {
              args = {};
            }
          }
          const toolCall: LlmToolCall = {
            id: buf.id,
            name: buf.name as LlmToolCall["name"],
            arguments: args
          };
          toolCalls.push(toolCall);
          yield { type: "tool-call", toolCall };
          toolBuffers.delete(idx);
        }
      }
    }
  }

  yield { type: "done", text: fullText, toolCalls, raw: undefined };
}

export async function collectClaudeSseResult(
  body: ReadableStream<Uint8Array>,
  model: string
): Promise<{ text: string; toolCalls: LlmToolCall[] }> {
  let text = "";
  let toolCalls: LlmToolCall[] = [];
  let sawAnyEvent = false;

  for await (const event of parseClaudeSSE(body, model)) {
    sawAnyEvent = true;
    if (event.type === "done") {
      text = event.text;
      toolCalls = event.toolCalls;
    }
  }

  if (!sawAnyEvent) {
    throw new Error("Claude SSE 空响应");
  }

  return { text, toolCalls };
}
