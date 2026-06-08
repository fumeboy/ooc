import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../_shared/method-types.js";
import type { Intent, MethodCallSchema } from "../../../thinkable/context/intent.js";
import type { ContextWindow } from "../_shared/types.js";
import type { MethodExecWindow } from "../method_exec/types.js";
import type { BaseContextWindow } from "@ooc/core/_shared";
import type { DoWindow } from "../_shared/types.js";
import { archiveDoWindowChild } from "./helpers.js";

const DO_WINDOW_CLOSE_BASIC = "internal/windows/do/close/basic";
const CLOSE_KNOWLEDGE = `
do_window.close 等价于 close tool，但语义上明确表达"归档子线程对话"。
关闭后子线程会被标记为 archived，不再被 scheduler 选中执行。
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

async function executeDoWindowClose(ctx: MethodExecutionContext): Promise<string | undefined> {
  // P6.§3: manager 在 dispatch 阶段已保证 self.type === "do"，method 体不再 re-check。
  const window = ctx.self as DoWindow;
  archiveDoWindowChild(ctx.thread, window);
  return undefined;
}

export const closeMethod: ObjectMethod = {
  paths: ["close"],
  schema: { args: {} } as MethodCallSchema,
  intent: (): Intent[] => [],
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const entries: Record<string, string> = { [DO_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE };
    return guidanceWindows(form, entries);
  },
  exec: (ctx) => executeDoWindowClose(ctx),
};
