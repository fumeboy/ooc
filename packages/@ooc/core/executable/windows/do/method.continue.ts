import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../_shared/command-types.js";
import type { Intent, MethodCallSchema } from "../../../thinkable/context/intent.js";
import type { ContextWindow } from "../_shared/types.js";
import type { MethodExecWindow } from "../method_exec/types.js";
import type { BaseContextWindow } from "@ooc/core/_shared";
import type { DoWindow } from "../_shared/types.js";
import { notifyThreadActivated } from "../../../observable/index.js";
import { appendInbox, findThreadInScope, makeMessage } from "./helpers.js";

const DO_WINDOW_CONTINUE_BASIC = "internal/windows/do/continue/basic";
const DO_WINDOW_CONTINUE_INPUT = "internal/windows/do/continue/input";

const CONTINUE_KNOWLEDGE = `
do_window.continue 用于向 do_window 关联的对端线程追加消息。

适用方向（两种都合法）：
- **父→子（主流）**：父 thread 在自己创建的子 do_window 上调，向 child 追加任务/消息
- **子→父 reply（root cause #1 dogfooding 闭环）**：子 thread 在自身的 creator do_window
  （isCreatorWindow=true）上调，把结果 / 状态 / 中间进展回报给父——这是子→父的**唯一**
  合法通道，不要试图通过 \`end({result})\` 等隐式参数夹带

参数：
- msg: 必填，要追加的消息
- wait: 可选，true 时本 thread 进入 waiting，等对端回写消息再唤醒

示例（父向子追加）：
open(parent_window_id="<do_window_id>", method="continue", title="追加任务", args={ msg: "再处理一批", wait: true })

示例（子向父回报）：
open(parent_window_id="<creator_do_window_id>", method="continue", args={ msg: "已处理完毕：见 memo/x.md" })
`.trim();

function guidanceWindows(form: BaseContextWindow, entries: Record<string, string>): ContextWindow[] {
  // batch C narrowing(N3): form 契约层是 base ContextWindow；只读 base id + 具体 form 的 command，narrow 一次。
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

async function executeDoWindowContinue(ctx: MethodExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return undefined;
  // P6.§3: manager 在 dispatch 阶段已保证 self.type === "do"，method 体不再 re-check。
  const window = ctx.self as DoWindow;
  const targetThreadId = window.targetThreadId;
  // 同时支持 parent→child（findChild 向下）与 child→parent（沿 _parentThreadRef 向上）
  // 用法；后者是 root cause #1 子→父 reply 协议的实现基础。
  const target = findThreadInScope(thread, targetThreadId);
  if (!target) {
    return `[do_window.continue] 找不到目标线程 ${targetThreadId}。`;
  }

  const content = typeof ctx.args.msg === "string" ? ctx.args.msg : "";
  if (!content) return "[do_window.continue] 缺少 msg。";

  const message = makeMessage(thread.id, targetThreadId, content);
  appendInbox(target, message);
  if (target.status === "done" || target.status === "failed") {
    target.status = "running";
  }
  thread.outbox = [...(thread.outbox ?? []), message];

  if (ctx.args.wait === true) {
    thread.status = "waiting";
    thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
    thread.waitingOn = ctx.self?.id;
  }

  // 根因 #5：父→子 / 子→父 inbox 写入后通知 runtime 入队 target。
  // target.persistence 可能缺失（child thread 在父 thread 内存树里时只挂在父 thread.json
  // 上，没独立 ref）— 此时无需通知，target 与父在同一 thread.json，下一轮 runJob 自然处理。
  if (target.persistence) {
    notifyThreadActivated({
      sessionId: target.persistence.sessionId,
      objectId: target.persistence.objectId,
      threadId: target.id,
    });
  }
  return undefined;
}

export const continueMethod: ObjectMethod = {
  paths: ["continue", "continue.wait"],
  schema: {
    args: {
      msg: { type: "string", required: true, description: "要追加的消息" },
      wait: { type: "boolean", required: false, default: false, description: "true 时本 thread 进入 waiting，等对端回写消息再唤醒" },
    },
  } as MethodCallSchema,
  intent: (args): Intent[] => {
    const hit: Intent[] = [];
    if (args.wait === true) hit.push({ name: "continue.wait" });
    return hit;
  },
  onFormChange(change, { form, intents: _intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [DO_WINDOW_CONTINUE_BASIC]: CONTINUE_KNOWLEDGE };
    if (formStatus === "open" && (typeof args.msg !== "string" || args.msg.trim().length === 0)) {
      entries[DO_WINDOW_CONTINUE_INPUT] = "do_window.continue 需要 msg；用 refine(args={ msg: \"...\", wait: true|false })。";
    }
    return guidanceWindows(form, entries);
  },
  exec: (ctx) => executeDoWindowContinue(ctx),
};
