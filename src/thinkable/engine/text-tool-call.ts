import type { ToolCall } from "../llm/client.js";

function decodeXmlText(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseTextToolInvocation(text: string): { name: string; args: Record<string, unknown> } | null {
  const trimmed = decodeXmlText(text);
  const match = trimmed.match(/^\s*([A-Za-z_][\w-]*)\s*\(([\s\S]*)\)\s*$/);
  if (!match) return null;
  const args = parseJsonObject(match[2] ?? "");
  if (!args) return null;
  return { name: match[1]!, args };
}

/**
 * Some providers occasionally emit our process_event XML as assistant text even
 * when tools are supplied. Treat a single textual tool event as a normal tool
 * call so the scheduler does not spin until the iteration limit.
 */
export function parseTextualToolCall(llmOutput: string): ToolCall[] | undefined {
  const events = llmOutput.match(/<process_event\b[\s\S]*?<\/process_event>/g) ?? [];
  for (const event of events) {
    if (!/\btype="tool_use"/.test(event)) continue;

    const name = event.match(/\bname="([^"]+)"/)?.[1];
    const argsText = event.match(/<args>\s*([\s\S]*?)\s*<\/args>/)?.[1];
    let parsed = argsText ? parseJsonObject(decodeXmlText(argsText)) : null;

    let toolName = name;
    if (!parsed) {
      const content = event.match(/<content>\s*([\s\S]*?)\s*<\/content>/)?.[1];
      const invocation = content ? parseTextToolInvocation(content) : null;
      if (invocation) {
        toolName = invocation.name;
        parsed = invocation.args;
      }
    }

    if (toolName && parsed) {
      return [{
        id: `textual_${Date.now().toString(36)}`,
        type: "function",
        function: { name: toolName, arguments: JSON.stringify(parsed) },
      }];
    }
  }

  const invocation = parseTextToolInvocation(llmOutput);
  if (!invocation) return undefined;
  return [{
    id: `textual_${Date.now().toString(36)}`,
    type: "function",
    function: { name: invocation.name, arguments: JSON.stringify(invocation.args) },
  }];
}
