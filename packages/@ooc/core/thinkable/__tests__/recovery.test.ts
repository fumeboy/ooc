import { describe, it, expect } from "bun:test";
import { detectInterruptedThread, markInterrupted } from "../recovery";
import type { ThreadContext } from "../context";

function makeThread(events: ThreadContext["events"]): ThreadContext {
  return {
    id: "t1",
    status: "running",
    events,
    contextWindows: [],
  };
}

describe("detectInterruptedThread", () => {
  it("trailing call_started without subsequent llm_interaction → interrupted", () => {
    const t = makeThread([
      { category: "context_change", kind: "inbox_message_arrived", msgId: "m1" },
      { category: "llm_interaction", kind: "call_started", loopIndex: 1 },
    ]);
    expect(detectInterruptedThread(t).interrupted).toBe(true);
  });

  it("call_started followed by text → not interrupted", () => {
    const t = makeThread([
      { category: "llm_interaction", kind: "call_started", loopIndex: 1 },
      { category: "llm_interaction", kind: "text", text: "hi" },
    ]);
    expect(detectInterruptedThread(t).interrupted).toBe(false);
  });

  it("legacy fallback: debugInputExists + no llm_interaction → interrupted", () => {
    const t = makeThread([
      { category: "context_change", kind: "inbox_message_arrived", msgId: "m1" },
    ]);
    expect(detectInterruptedThread(t, { debugInputExists: true }).interrupted).toBe(true);
    expect(detectInterruptedThread(t).interrupted).toBe(false);
  });

  it("empty events → not interrupted", () => {
    expect(detectInterruptedThread(makeThread([])).interrupted).toBe(false);
  });

  it("markInterrupted appends inject event", () => {
    const t = makeThread([
      { category: "llm_interaction", kind: "call_started", loopIndex: 1 },
    ]);
    markInterrupted(t);
    const last = t.events.at(-1)!;
    expect(last.category).toBe("context_change");
    expect(last.kind).toBe("inject");
  });
});
