import { describe, expect, test } from "bun:test";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import {
  applyResumeTransition,
  canResumeThread,
} from "./thread-transition";

function makeThread(overrides: Partial<ThreadContext> = {}): ThreadContext {
  return {
    id: "root",
    class: "_builtin/agent/thread",
    status: "running",
    events: [],
    contextWindows: [],
    ...overrides,
  };
}

describe("thread transition (ContextWindow model)", () => {
  test("resume only accepts paused thread", () => {
    expect(canResumeThread(makeThread({ status: "paused" }))).toBe(true);
    expect(canResumeThread(makeThread({ status: "running" }))).toBe(false);
  });

  test("resume transition flips paused thread to running and clears snapshot", () => {
    const next = applyResumeTransition(
      makeThread({
        status: "paused",
        inboxSnapshotAtWait: 5,
      }),
    );

    expect(next.status).toBe("running");
    expect(next.inboxSnapshotAtWait).toBeUndefined();
  });
});
