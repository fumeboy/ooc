/**
 * formatOoc3Thread — converts ooc-3 ThinkThread messages[] into ChatLine[].
 *
 * ooc-3 ThinkThread has messages: LlmInputItem[] with no events[], no contextWindows,
 * no inbox/outbox. This formatter is the adaptation layer between ooc-3's message model
 * and the ooc-2 TuiBlock rendering layer.
 *
 * Mapping (see migration map §6):
 *   {type:"message", role:"user"}       → ChatLine kind:"message" role:"user"
 *   {type:"message", role:"assistant"}  → ChatLine kind:"message" role:"assistant"
 *   {type:"message", role:"system"}     → ChatLine kind:"notice" tone:"info" — DEFAULT COLLAPSED
 *   {type:"function_call"}              → ChatLine kind:"tool" (with pending flag if no output yet)
 *   {type:"function_call_output"}       → paired with preceding function_call by call_id
 *   {type:"reasoning"}                  → ChatLine kind:"notice" tone:"warning" title:"Thinking"
 */

import type { ChatLine, LlmInputItem, ThinkThread } from "./model";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function stringifyArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function parseJsonString(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

function deriveOkFromOutput(outputStr: string): boolean | undefined {
  const parsed = parseJsonString(outputStr);
  if (isRecord(parsed) && "ok" in parsed) {
    const v = (parsed as Record<string, unknown>).ok;
    if (typeof v === "boolean") return v;
  }
  return undefined;
}

/**
 * Build a short header description for well-known ooc-3 tools.
 * ooc-3 tools: talk, todo_add, todo_done, todo_list, plan_set, plan_get,
 *   grep, open_file, write_file, exec_command, end, etc.
 */
function buildHeaderDescription(name: string, args: Record<string, unknown>): string | undefined {
  if (name === "talk") {
    const target = typeof args.target === "string" ? args.target : undefined;
    if (target) {
      // Extract short name from ooc:// URI if present
      const m = target.match(/objects\/([^/]+)$/);
      return m ? `→ ${m[1]}` : `→ ${target}`;
    }
  }
  if (name === "exec_command" || name === "exec") {
    const cmd = typeof args.command === "string" ? args.command : undefined;
    return cmd ? cmd.slice(0, 100) : undefined;
  }
  if (name === "open_file" || name === "read_file") {
    const path = typeof args.path === "string" ? args.path : undefined;
    return path ? path.slice(0, 120) : undefined;
  }
  if (name === "write_file") {
    const path = typeof args.path === "string" ? args.path : undefined;
    return path ? path.slice(0, 120) : undefined;
  }
  if (name === "grep") {
    const pattern = typeof args.pattern === "string" ? args.pattern : undefined;
    return pattern ? pattern.slice(0, 80) : undefined;
  }
  if (name === "todo_add") {
    const text = typeof args.text === "string" ? args.text : undefined;
    return text ? text.slice(0, 100) : undefined;
  }
  if (name === "plan_set") {
    const content = typeof args.content === "string" ? args.content : undefined;
    return content ? content.split("\n")[0]?.slice(0, 80) : undefined;
  }
  return undefined;
}

/**
 * Truncate long output to a reasonable display length.
 * tool outputs in ooc-3 can be very large (file contents, grep results, etc.)
 */
const OUTPUT_TRUNCATE_CHARS = 8000;

function truncateOutput(output: string): string {
  if (output.length <= OUTPUT_TRUNCATE_CHARS) return output;
  const truncated = output.slice(0, OUTPUT_TRUNCATE_CHARS);
  return `${truncated}\n… (truncated, ${output.length - OUTPUT_TRUNCATE_CHARS} more chars)`;
}

/**
 * Convert ooc-3 ThinkThread.messages into ChatLine[].
 *
 * Key design decisions:
 * 1. Pre-scan all function_call_output items and index by call_id.
 *    When we encounter a function_call, pair it immediately with its output.
 * 2. Consumed output items are tracked to avoid duplicate rendering.
 * 3. System messages are rendered as collapsed notice blocks (ooc-3 injects
 *    large context snapshots as system messages — flooding timeline by default
 *    would make the UI unusable).
 * 4. No open/refine/submit/close window protocol in ooc-3 — tools are plain names.
 */
export function formatOoc3Thread(thread?: ThinkThread | null): ChatLine[] {
  if (!thread) return [];
  const messages = thread.messages ?? [];
  if (messages.length === 0) return [];

  const lines: ChatLine[] = [];

  // Pre-scan function_call_output items by call_id for pairing
  const outputByCallId = new Map<string, { item: Extract<LlmInputItem, { type: "function_call_output" }>; index: number }>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.type === "function_call_output") {
      if (!outputByCallId.has(msg.call_id)) {
        outputByCallId.set(msg.call_id, { item: msg, index: i });
      }
    }
  }
  const consumedOutputIndices = new Set<number>();

  for (let index = 0; index < messages.length; index++) {
    const msg = messages[index];
    if (!msg) continue;

    if (msg.type === "message") {
      if (msg.role === "user") {
        lines.push({
          id: `msg-${index}`,
          kind: "message",
          role: "user",
          content: msg.content,
        });
        continue;
      }

      if (msg.role === "assistant") {
        // Skip empty assistant messages (common when only tool calls were made)
        if (!msg.content.trim()) continue;
        lines.push({
          id: `msg-${index}`,
          kind: "message",
          role: "assistant",
          content: msg.content,
        });
        continue;
      }

      if (msg.role === "system") {
        // System messages carry OOC context snapshots — render as collapsed notice.
        // Default collapsed so large context dumps don't flood the timeline.
        const preview = msg.content.slice(0, 120).replace(/\n/g, " ");
        lines.push({
          id: `system-${index}`,
          kind: "notice",
          role: "notice",
          title: "system",
          content: msg.content,
          tone: "info",
          // NOTE: TuiBlock notice blocks don't have a built-in "defaultCollapsed" prop.
          // We encode the hint in a comment field; the adapted NoticeBlock will
          // honour defaultCollapsed for system notices. Until that's wired, the
          // notice block renders expanded but clearly labelled.
          meta: `system · ${preview}…`,
        } as ChatLine & { meta?: string });
        continue;
      }
      continue;
    }

    if (msg.type === "function_call") {
      const matched = outputByCallId.get(msg.call_id);
      if (matched) consumedOutputIndices.add(matched.index);

      const argsText = stringifyArgs(msg.arguments);
      const outputText = matched ? truncateOutput(matched.item.output) : undefined;
      const ok = matched ? (deriveOkFromOutput(matched.item.output) ?? true) : undefined;

      lines.push({
        id: msg.call_id,
        kind: "tool",
        role: "tool",
        toolName: msg.name,
        callId: msg.call_id,
        headerDescription: buildHeaderDescription(msg.name, msg.arguments),
        rawArguments: msg.arguments,
        rawOutput: matched ? matched.item.output : undefined,
        argumentsText: argsText,
        outputText,
        ok,
        pending: !matched,
      });
      continue;
    }

    if (msg.type === "function_call_output") {
      // Skip outputs that were already paired with their function_call
      if (consumedOutputIndices.has(index)) continue;
      // Orphan output (no preceding function_call) — render as standalone tool result
      const outputText = truncateOutput(msg.output);
      const ok = deriveOkFromOutput(msg.output);
      lines.push({
        id: `${msg.call_id}-output`,
        kind: "tool",
        role: "tool",
        toolName: msg.name ?? "tool_output",
        callId: msg.call_id,
        rawOutput: msg.output,
        outputText,
        ok,
      });
      continue;
    }

    if (msg.type === "reasoning") {
      if (!msg.text.trim()) continue;
      lines.push({
        id: `reasoning-${index}`,
        kind: "notice",
        role: "notice",
        title: "Thinking",
        content: msg.text,
        tone: "warning",
      });
      continue;
    }
  }

  return lines;
}
