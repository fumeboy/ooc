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
    ...overrides,
  };
}

describe("thread transition", () => {
  test("inject resets failed thread to running and clears waiting metadata", () => {
    const next = applyInjectTransition(
      makeThread({
        status: "failed",
        waitingType: "await_children",
        awaitingChildren: ["child-1"],
      }),
      "继续"
    );

    expect(next.status).toBe("running");
    expect(next.waitingType).toBeUndefined();
    expect(next.awaitingChildren).toBeUndefined();
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

  test("resume transition flips paused thread to running", () => {
    const next = applyResumeTransition(
      makeThread({
        status: "paused",
        waitingType: "explicit_wait",
      })
    );

    expect(next.status).toBe("running");
    expect(next.waitingType).toBeUndefined();
  });
});
