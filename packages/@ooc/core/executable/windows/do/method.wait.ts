import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../_shared/method-types.js";
import type { Intent } from "../../../thinkable/context/intent.js";
import type { ContextWindow } from "../_shared/types.js";
import type { MethodExecWindow } from "../method_exec/types.js";
import type { BaseContextWindow } from "@ooc/core/_shared";

const DO_WINDOW_WAIT_BASIC = "internal/windows/do/wait/basic";
const WAIT_KNOWLEDGE = `
do_window.wait：不向子线程发消息，仅把当前父线程切到 waiting 直到子线程回写。

参数：无
`.trim();

function guidanceWindows(form: BaseContextWindow, entries: Record<string, string>): ContextWindow[] {
  // batch C narrowing(N3): form 契约层是 base ContextWindow；只读 base id + 具体 form 的 method，narrow 一次。
  const sourceId = (form as MethodExecWindow).method;
  const out: ContextWindow[] = [];
  for (const [path, text] of Object.entries(entries)) {
    const safe = path.replace(/[^a-zA-Z0-9_]/g, "_");
    out.push({
      id: "guidance_" + form.id + "_" + safe,
      type: "guidance",
      parentWindowId: form.id,
      boundFormId: form.id,
      title: path,
      status: "open",
      createdAt: 0,
      relevance: { score: 0.8, signalCount: 1 },
      provenance: {
        kind: "derived",
        reason: { mechanism: "form_bound", sourceId },
        createdAt: 0,
        lastTouchedAt: 0,
      },
      content: text,
      summary: text.length > 200 ? text.slice(0, 200) + "..." : text,
    } as ContextWindow);
  }
  return out;
}

async function executeDoWindowWait(ctx: MethodExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return undefined;
  thread.status = "waiting";
  thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
  thread.waitingOn = ctx.self?.id;
  return undefined;
}

export const waitMethod: ObjectMethod = {
  paths: ["wait"],
  intent: (): Intent[] => [],
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const entries: Record<string, string> = { [DO_WINDOW_WAIT_BASIC]: WAIT_KNOWLEDGE };
    return guidanceWindows(form, entries);
  },
  exec: (ctx) => executeDoWindowWait(ctx),
};
