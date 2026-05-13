import type { CommandExecutionContext, CommandKnowledgeEntries, CommandTableEntry } from "./types.js";
import type { ThreadContext, ThreadMessage } from "../../thinkable/context.js";
import { FormManager, type ActiveForm } from "../forms/form.js";

/** do command 暴露给 LLM 的知识说明。 */
const KNOWLEDGE = `
do 用于在当前对象内部派生子线程，或向已有子线程继续追加消息。

参数说明：
- context: 必填，fork 或 continue
- msg: 必填，要写入目标线程 inbox 的消息
- threadId: 可选；continue 时通常必填，fork 时可指定父线程
- knowledge: 可选，仅 fork 时给子线程额外引入的 knowledge path 列表
- wait: 可选，fork 后是否等待子线程完成

调用示例：
open(type="command", command="do", description="派生子线程处理子任务")
refine(form_id, { context: "fork", msg: "请检查日志", wait: true, knowledge: ["kernel:debug"] })
submit(form_id)
`;

const DO_BASIC_PATH = "internal/executable/do/basic";
const DO_INPUT_PATH = "internal/executable/do/input";

/** do command 的可匹配路径集合。 */
export enum DoCommandPath {
  /** 基础 do 指令：执行动作。 */
  Do = "do",
  /** fork 模式：在新线程中执行动作。 */
  Fork = "do.fork",
  /** continue 模式：向已有线程追加消息。 */
  Continue = "do.continue",
  /** wait 模式：等待子线程完成。 */
  Wait = "do.wait",
}

/** do command 表项：根据 context/wait/target 派生路径。 */
export const doCommand: CommandTableEntry = {
  paths: [
    DoCommandPath.Do,
    DoCommandPath.Fork,
    DoCommandPath.Continue,
    DoCommandPath.Wait,
  ],
  match: (args) => {
    const hit: string[] = [DoCommandPath.Do];
    const ctx = typeof args.context === "string" ? args.context : "";
    if (ctx === "fork") hit.push(DoCommandPath.Fork);
    if (ctx === "continue") hit.push(DoCommandPath.Continue);
    if (args.wait === true) hit.push(DoCommandPath.Wait);
    return hit;
  },
  knowledge: (args) => {
    const entries: CommandKnowledgeEntries = {
      [DO_BASIC_PATH]: KNOWLEDGE.trim(),
    };
    const context = typeof args.context === "string" ? args.context : "";
    const hasMsg = typeof args.msg === "string" && args.msg.trim().length > 0;
    const hasThreadId = typeof args.threadId === "string" && args.threadId.trim().length > 0;
    if (context === "continue" && (!hasThreadId || !hasMsg)) {
      entries[DO_INPUT_PATH] = "do.continue 需要 threadId 与 msg；请先 refine(args={ context: \"continue\", threadId: \"...\", msg: \"...\" })。";
    } else if (context === "fork" && !hasMsg) {
      entries[DO_INPUT_PATH] = "do.fork 需要 msg；请先 refine(args={ context: \"fork\", msg: \"...\", wait: true|false })。";
    } else if (context !== "fork" && context !== "continue") {
      entries[DO_INPUT_PATH] = "do 需要 context=fork 或 context=continue；请先 refine 补充 context 与 msg。";
    }
    return entries;
  },
  // 暂不实现具体执行逻辑
};

/** 生成内存线程 ID；当前只要求本地测试期间足够唯一。 */
function generateThreadId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 构造 do 派生的线程间消息。 */
function generateMessage(
  fromThreadId: string,
  toThreadId: string,
  content: string,
): ThreadMessage {
  return {
    id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    fromThreadId,
    toThreadId,
    content,
    createdAt: Date.now(),
    source: "do",
  };
}

function appendInboxMessage(thread: ThreadContext, message: ThreadMessage): ThreadContext {
  return {
    ...thread,
    inbox: [...(thread.inbox ?? []), message],
    events: [
      ...(thread.events ?? []),
      {
        category: "context_change",
        kind: "inbox_message_arrived",
        msgId: message.id,
      },
    ],
  };
}

/** 为 fork 出来的子线程创建“处理初始消息”的 todo form。 */
function createInitialTodoForms(content: string): ActiveForm[] {
  const formManager = new FormManager();
  const formId = formManager.open("todo", "处理初始消息");
  formManager.refine(formId, { content });
  return formManager.toData();
}

/** 在当前内存线程树中按 ID 深度优先查找线程。 */
function findThread(root: ThreadContext, threadId: string): ThreadContext | null {
  if (root.id === threadId) return root;
  for (const child of Object.values(root.childThreads ?? {})) {
    const found = findThread(child, threadId);
    if (found) return found;
  }
  return null;
}

/** 执行 do command：fork 创建子线程，continue 向既有线程追加消息。 */
export async function executeDoCommand(ctx: CommandExecutionContext): Promise<string | undefined> {
  if (!ctx.thread) return undefined;

  const mode = ctx.args.context === "continue" ? "continue" : "fork";
  const content = typeof ctx.args.msg === "string" ? ctx.args.msg : "";
  const targetThreadId = typeof ctx.args.threadId === "string" ? ctx.args.threadId : undefined;

  // fork 直接在目标父线程下挂一个新的运行中子线程，并把初始消息写入 inbox。
  if (mode === "fork") {
    const parentThread = targetThreadId ? findThread(ctx.thread, targetThreadId) : ctx.thread;
    if (!parentThread) return;

    const childId = generateThreadId();
    const message = generateMessage(ctx.thread.id, childId, content);
    const childThread = appendInboxMessage({
      id: childId,
      status: "running",
      events: [],
      parentThreadId: parentThread.id,
      creatorThreadId: ctx.thread.id,
      activeForms: createInitialTodoForms(content),
    }, message);

    parentThread.childThreadIds = [...(parentThread.childThreadIds ?? []), childId];
    parentThread.childThreads = {
      ...(parentThread.childThreads ?? {}),
      [childId]: childThread,
    };
    ctx.thread.outbox = [...(ctx.thread.outbox ?? []), message];

    // wait=true 时由当前线程等待新建的子线程完成。
    if (ctx.args.wait === true) {
      ctx.thread.status = "waiting";
      ctx.thread.waitingType = "await_children";
      ctx.thread.awaitingChildren = [childId];
    }
    return;
  }

  // continue 向现有线程追加消息；done/failed 线程收到新 inbox 后翻回 running。
  if (!targetThreadId) return;
  const targetThread = findThread(ctx.thread, targetThreadId);
  if (!targetThread) return;

  const message = generateMessage(ctx.thread.id, targetThreadId, content);
  const nextTargetThread = appendInboxMessage(targetThread, message);
  if (targetThread.status === "done" || targetThread.status === "failed") {
    nextTargetThread.status = "running";
  }
  Object.assign(targetThread, nextTargetThread);
  ctx.thread.outbox = [...(ctx.thread.outbox ?? []), message];

  // 与 fork 分支对称：wait=true 时父线程进入 await_children
  if (ctx.args.wait === true) {
    ctx.thread.status = "waiting";
    ctx.thread.waitingType = "await_children";
    ctx.thread.awaitingChildren = [targetThreadId];
  }
}
