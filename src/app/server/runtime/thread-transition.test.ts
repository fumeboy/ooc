import { describe, expect, test } from "bun:test";
import type { ThreadContext } from "@src/thinkable/context";
import {
  applyInjectTransition,
  applyResumeTransition,
  canResumeThread,
} from "./thread-transition";

function makeThread(overrides: Partial<ThreadContext> = {}): ThreadContext {
  return {
    id: "root",
    status: "running",
    events: [],
    contextWindows: [],
    ...overrides,
  };
}

describe("thread transition (ContextWindow model)", () => {
  test("inject resets failed thread to running and clears waiting snapshot", () => {
    const next = applyInjectTransition(
      makeThread({
        status: "failed",
        inboxSnapshotAtWait: 3,
      }),
      "继续",
    );

    expect(next.status).toBe("running");
    expect(next.inboxSnapshotAtWait).toBeUndefined();
    expect(next.events.at(-1)).toEqual({
      category: "context_change",
      kind: "inject",
      text: "继续",
    });
  });

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
