/**
 * Unit tests for formatOoc3Thread — the ooc-3 message → ChatLine converter.
 *
 * Covers:
 * - Empty / null thread
 * - Each LlmInputItem type: message (user/assistant/system), function_call,
 *   function_call_output, reasoning
 * - function_call + function_call_output pairing by call_id
 * - Orphan function_call_output (no matching call)
 * - Pending tool call (function_call with no output yet)
 * - System message collapse hint (tone:"info", title:"system")
 * - Empty assistant message skip
 * - Output truncation
 */
import { expect, test, describe } from "bun:test";
import { formatOoc3Thread } from "../formatOoc3Thread";
import type { ThinkThread } from "../model";

function makeThread(messages: ThinkThread["messages"]): ThinkThread {
  return {
    id: "t1",
    sessionId: "s1",
    objectUri: "ooc://stones/main/objects/supervisor",
    messages,
    status: "done",
    maxTicks: 10,
    ticks: 3,
  };
}

describe("formatOoc3Thread", () => {
  test("returns [] for null/undefined thread", () => {
    expect(formatOoc3Thread(null)).toEqual([]);
    expect(formatOoc3Thread(undefined)).toEqual([]);
  });

  test("returns [] for empty messages", () => {
    const thread = makeThread([]);
    expect(formatOoc3Thread(thread)).toEqual([]);
  });

  test("user message → ChatLine kind:message role:user", () => {
    const thread = makeThread([
      { type: "message", role: "user", content: "Hello agent" },
    ]);
    const lines = formatOoc3Thread(thread);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: "message",
      role: "user",
      content: "Hello agent",
    });
  });

  test("assistant message → ChatLine kind:message role:assistant", () => {
    const thread = makeThread([
      { type: "message", role: "assistant", content: "Hello user, I will help." },
    ]);
    const lines = formatOoc3Thread(thread);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: "message",
      role: "assistant",
      content: "Hello user, I will help.",
    });
  });

  test("empty assistant message is skipped", () => {
    const thread = makeThread([
      { type: "message", role: "assistant", content: "" },
      { type: "message", role: "assistant", content: "   " },
    ]);
    const lines = formatOoc3Thread(thread);
    expect(lines).toHaveLength(0);
  });

  test("system message → ChatLine kind:notice tone:info title:system (default collapsed)", () => {
    const thread = makeThread([
      { type: "message", role: "system", content: "[OOC context snapshot]\nLots of context here..." },
    ]);
    const lines = formatOoc3Thread(thread);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.kind).toBe("notice");
    expect(line.role).toBe("notice");
    if (line.kind === "notice") {
      expect(line.title).toBe("system");
      expect(line.tone).toBe("info");
      expect(line.content).toContain("[OOC context snapshot]");
    }
  });

  test("function_call with matching output → paired tool line", () => {
    const thread = makeThread([
      {
        type: "function_call",
        call_id: "c1",
        name: "todo_add",
        arguments: { text: "buy milk" },
      },
      {
        type: "function_call_output",
        call_id: "c1",
        name: "todo_add",
        output: '{"ok":true,"id":"todo_1"}',
      },
    ]);
    const lines = formatOoc3Thread(thread);
    // Should produce exactly 1 tool line (output consumed into call)
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.kind).toBe("tool");
    expect(line.role).toBe("tool");
    if (line.kind === "tool") {
      expect(line.toolName).toBe("todo_add");
      expect(line.callId).toBe("c1");
      expect(line.ok).toBe(true);
      expect(line.pending).toBe(false);
      expect(line.outputText).toContain("ok");
    }
  });

  test("function_call with no output → pending tool line", () => {
    const thread = makeThread([
      {
        type: "function_call",
        call_id: "c2",
        name: "exec_command",
        arguments: { command: "ls /" },
      },
    ]);
    const lines = formatOoc3Thread(thread);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.kind).toBe("tool");
    if (line.kind === "tool") {
      expect(line.pending).toBe(true);
      expect(line.ok).toBeUndefined();
    }
  });

  test("function_call_output not consumed by call → orphan tool line", () => {
    const thread = makeThread([
      {
        type: "function_call_output",
        call_id: "c_orphan",
        name: "grep",
        output: "results here",
      },
    ]);
    const lines = formatOoc3Thread(thread);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.kind).toBe("tool");
    if (line.kind === "tool") {
      expect(line.callId).toBe("c_orphan");
      expect(line.outputText).toBe("results here");
    }
  });

  test("reasoning → ChatLine kind:notice tone:warning title:Thinking", () => {
    const thread = makeThread([
      { type: "reasoning", text: "Let me think about this step by step..." },
    ]);
    const lines = formatOoc3Thread(thread);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.kind).toBe("notice");
    if (line.kind === "notice") {
      expect(line.title).toBe("Thinking");
      expect(line.tone).toBe("warning");
      expect(line.content).toBe("Let me think about this step by step...");
    }
  });

  test("empty reasoning is skipped", () => {
    const thread = makeThread([
      { type: "reasoning", text: "" },
      { type: "reasoning", text: "   " },
    ]);
    const lines = formatOoc3Thread(thread);
    expect(lines).toHaveLength(0);
  });

  test("mixed message types produce correct order", () => {
    const thread = makeThread([
      { type: "message", role: "system", content: "system context" },
      { type: "message", role: "user", content: "user question" },
      { type: "reasoning", text: "thinking..." },
      {
        type: "function_call",
        call_id: "c3",
        name: "talk",
        arguments: { target: "ooc://stones/main/objects/supervisor", content: "help" },
      },
      {
        type: "function_call_output",
        call_id: "c3",
        output: '{"ok":true}',
      },
      { type: "message", role: "assistant", content: "Done!" },
    ]);
    const lines = formatOoc3Thread(thread);
    // system(notice) + user(message) + reasoning(notice) + tool(1 paired) + assistant(message)
    expect(lines).toHaveLength(5);
    expect(lines[0]?.kind).toBe("notice"); // system
    expect(lines[1]?.kind).toBe("message"); // user
    if (lines[1]?.kind === "message") expect(lines[1].role).toBe("user");
    expect(lines[2]?.kind).toBe("notice"); // reasoning
    expect(lines[3]?.kind).toBe("tool");   // function_call (paired)
    expect(lines[4]?.kind).toBe("message"); // assistant
    if (lines[4]?.kind === "message") expect(lines[4].role).toBe("assistant");
  });

  test("multiple parallel function_calls paired by call_id", () => {
    const thread = makeThread([
      {
        type: "function_call",
        call_id: "ca",
        name: "grep",
        arguments: { pattern: "foo", path: "." },
      },
      {
        type: "function_call",
        call_id: "cb",
        name: "open_file",
        arguments: { path: "README.md" },
      },
      {
        type: "function_call_output",
        call_id: "ca",
        output: "file.ts:1:foo",
      },
      {
        type: "function_call_output",
        call_id: "cb",
        output: "# README content",
      },
    ]);
    const lines = formatOoc3Thread(thread);
    // Both calls paired with outputs: 2 tool lines, no orphan outputs
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.kind).toBe("tool");
      if (line.kind === "tool") {
        expect(line.pending).toBe(false);
      }
    }
  });

  test("talk tool shows target as headerDescription", () => {
    const thread = makeThread([
      {
        type: "function_call",
        call_id: "c_talk",
        name: "talk",
        arguments: { target: "ooc://stones/main/objects/supervisor", content: "ping" },
      },
      {
        type: "function_call_output",
        call_id: "c_talk",
        output: '{"ok":true}',
      },
    ]);
    const lines = formatOoc3Thread(thread);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    if (line.kind === "tool") {
      expect(line.headerDescription).toBe("→ supervisor");
    }
  });

  test("output truncation for very long outputs", () => {
    const longOutput = "x".repeat(10000);
    const thread = makeThread([
      {
        type: "function_call",
        call_id: "c_long",
        name: "read_file",
        arguments: { path: "big.txt" },
      },
      {
        type: "function_call_output",
        call_id: "c_long",
        output: longOutput,
      },
    ]);
    const lines = formatOoc3Thread(thread);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    if (line.kind === "tool") {
      expect(line.outputText!.length).toBeLessThan(longOutput.length);
      expect(line.outputText).toContain("truncated");
    }
  });

  test("failed tool call (ok:false in output)", () => {
    const thread = makeThread([
      {
        type: "function_call",
        call_id: "c_fail",
        name: "exec_command",
        arguments: { command: "nonexistent-cmd" },
      },
      {
        type: "function_call_output",
        call_id: "c_fail",
        output: '{"ok":false,"error":"command not found"}',
      },
    ]);
    const lines = formatOoc3Thread(thread);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    if (line.kind === "tool") {
      expect(line.ok).toBe(false);
      expect(line.pending).toBe(false);
    }
  });
});
