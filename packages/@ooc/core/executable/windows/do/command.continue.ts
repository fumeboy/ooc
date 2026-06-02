import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../_shared/command-types.js";
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
open(parent_window_id="<do_window_id>", command="continue", title="追加任务", args={ msg: "再处理一批", wait: true })

示例（子向父回报）：
open(parent_window_id="<creator_do_window_id>", command="continue", args={ msg: "已处理完毕：见 memo/x.md" })
`.trim();

async function executeDoWindowContinue(ctx: CommandExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return undefined;
  const window = ctx.self;
  if (!window || window.type !== "do") {
    return "[do_window.continue] 未挂载在 do_window 上，无法执行。";
  }
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

export const continueCommand: CommandTableEntry = {
  paths: ["continue", "continue.wait"],
  match: (args) => {
    const hit = ["continue"];
    if (args.wait === true) hit.push("continue.wait");
    return hit;
  },
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [DO_WINDOW_CONTINUE_BASIC]: CONTINUE_KNOWLEDGE };
    if (formStatus !== "open") return entries;
    if (typeof args.msg !== "string" || args.msg.trim().length === 0) {
      entries[DO_WINDOW_CONTINUE_INPUT] = "do_window.continue 需要 msg；用 refine(args={ msg: \"...\", wait: true|false })。";
    }
    return entries;
  },
  exec: (ctx) => executeDoWindowContinue(ctx),
};
