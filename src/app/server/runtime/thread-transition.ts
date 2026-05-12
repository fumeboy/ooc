import type { ThreadContext } from "@src/thinkable/context";

export function canResumeThread(thread: Pick<ThreadContext, "status">): boolean {
  return thread.status === "paused";
}

export function applyInjectTransition(thread: ThreadContext, text: string): ThreadContext {
  return {
    ...thread,
    status: "running",
    waitingType: undefined,
    awaitingChildren: undefined,
    events: [
      ...thread.events,
      {
        category: "context_change",
        kind: "inject",
        text,
      },
    ],
  };
}

export function applyResumeTransition(thread: ThreadContext): ThreadContext {
  if (!canResumeThread(thread)) {
    return thread;
  }

  return {
    ...thread,
    status: "running",
    waitingType: undefined,
    awaitingChildren: undefined,
  };
}
