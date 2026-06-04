import type {
  ObjectMethod,
} from "../_shared/command-types.js";
import type { Intent } from "../../../thinkable/context/intent.js";
import type { ContextWindow } from "../_shared/types.js";
import type { MethodExecWindow } from "../method_exec/types.js";

const TALK_WINDOW_CLOSE_BASIC = "internal/windows/talk/close/basic";
const CLOSE_KNOWLEDGE = `
talk_window.close 等价于 close tool；明确表达"结束本对话主题"。

注意：creator talk_window（callee thread 自带的、指向 caller 的那一条）不可关闭，
关闭会被拒绝并写一条 inject 提示。其它 talk_window 关闭后不会通知对端。
`.trim();

function guidanceWindows(form: MethodExecWindow, entries: Record<string, string>): ContextWindow[] {
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
        reason: { mechanism: "form_bound", sourceId: form.command },
        createdAt: 0,
        lastTouchedAt: 0,
      },
      content: text,
      summary: text.length > 200 ? text.slice(0, 200) + "..." : text,
    } as ContextWindow);
  }
  return out;
}

export const closeCommand: ObjectMethod = {
  paths: ["close"],
  intent: (): Intent[] => [],
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const entries: Record<string, string> = { [TALK_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE };
    return guidanceWindows(form, entries);
  },
  // close 副作用统一在 onClose hook，exec 体本身 no-op
  exec: () => undefined,
};
