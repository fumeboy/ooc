/**
 * do_window — fork 子线程后在父线程下产生的对话窗口。
 *
 * spec § do_window：
 * - targetThreadId：fork 出的 child thread id；transcript 视图按它过滤 inbox/outbox
 * - 注册的 command：continue / wait / close
 * - close 语义：B=ii archive — 把 child thread 标记为 archived；window 释放
 * - 特殊子类：初始 creator do_window（由 windows/init.ts 创建），不可被 LLM close
 */

import type { CommandExecutionContext, CommandKnowledgeEntries, CommandTableEntry } from "../commands/types.js";
import type { ThreadContext, ThreadMessage } from "../../thinkable/context.js";
import { registerWindowType, type OnCloseContext } from "./registry.js";
import type { DoWindow } from "./types.js";

// ---- continue command ----

const DO_WINDOW_CONTINUE_BASIC = "internal/windows/do/continue/basic";
const DO_WINDOW_CONTINUE_INPUT = "internal/windows/do/continue/input";

const CONTINUE_KNOWLEDGE = `
do_window.continue 用于向 do_window 关联的子线程追加消息。

参数：
- msg: 必填，要追加的消息
- wait: 可选，true 时父线程进入 waiting，等子线程回写消息再唤醒

示例：
open(parent_window_id="<do_window_id>", command="continue", title="追加任务", args={ msg: "再处理一批", wait: true })
`.trim();

const continueCommand: CommandTableEntry = {
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

// ---- wait command（do_window 上的"不发消息只等待"） ----

const DO_WINDOW_WAIT_BASIC = "internal/windows/do/wait/basic";
const WAIT_KNOWLEDGE = `
do_window.wait：不向子线程发消息，仅把当前父线程切到 waiting 直到子线程回写。

参数：无
`.trim();

const waitCommand: CommandTableEntry = {
  paths: ["wait"],
  match: () => ["wait"],
  knowledge: (): CommandKnowledgeEntries => ({ [DO_WINDOW_WAIT_BASIC]: WAIT_KNOWLEDGE }),
  exec: (ctx) => executeDoWindowWait(ctx),
};

// ---- close command（语义重复 close tool；保留避免 LLM 在 do_window 上找不到关闭方法）----

const DO_WINDOW_CLOSE_BASIC = "internal/windows/do/close/basic";
const CLOSE_KNOWLEDGE = `
do_window.close 等价于 close tool，但语义上明确表达"归档子线程对话"。
关闭后子线程会被标记为 archived，不再被 scheduler 选中执行。
`.trim();

const closeCommand: CommandTableEntry = {
  paths: ["close"],
  match: () => ["close"],
  knowledge: (): CommandKnowledgeEntries => ({ [DO_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE }),
  exec: (ctx) => executeDoWindowClose(ctx),
};

// ---- helper：把消息写入 child inbox + 父 outbox ----

function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function makeMessage(fromId: string, toId: string, content: string): ThreadMessage {
  return {
    id: generateMessageId(),
    fromThreadId: fromId,
    toThreadId: toId,
    content,
    createdAt: Date.now(),
    source: "do",
  };
}

function appendInbox(thread: ThreadContext, message: ThreadMessage): void {
  thread.inbox = [...(thread.inbox ?? []), message];
  thread.events = [
    ...thread.events,
    { category: "context_change", kind: "inbox_message_arrived", msgId: message.id },
  ];
}

/** 在父 thread 的子树里按 id 找子线程。 */
function findChild(parent: ThreadContext, childId: string): ThreadContext | null {
  if (parent.id === childId) return parent;
  for (const child of Object.values(parent.childThreads ?? {})) {
    const found = findChild(child, childId);
    if (found) return found;
  }
  return null;
}

/**
 * do_window.continue 的执行入口。
 *
 * 注意：command_exec 的 ctx.form 在重构后已不再可用；继续 command 通过 ctx.parentWindowId
 * 找到 do_window 实例，从中取 targetThreadId。
 */
export async function executeDoWindowContinue(ctx: CommandExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return undefined;
  const window = ctx.parentWindow;
  if (!window || window.type !== "do") {
    return "[do_window.continue] 未挂载在 do_window 上，无法执行。";
  }
  const targetThreadId = window.targetThreadId;
  const target = findChild(thread, targetThreadId);
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
  }
  return undefined;
}

/** do_window.wait 的执行入口：不发消息，只把父线程切到 waiting。 */
export async function executeDoWindowWait(ctx: CommandExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return undefined;
  thread.status = "waiting";
  thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
  return undefined;
}

/**
 * do_window.close 的执行入口：把子线程切到 archived；window 自身的移除由 close tool / WindowManager 完成。
 *
 * 此函数仅作为"通过 command 关闭 do_window"的快捷路径；onClose hook 会做同样副作用。
 * 调用 close tool 时也会触发 onClose，达到一致结果。
 */
export async function executeDoWindowClose(ctx: CommandExecutionContext): Promise<string | undefined> {
  const window = ctx.parentWindow;
  if (!window || window.type !== "do") {
    return "[do_window.close] 未挂载在 do_window 上。";
  }
  archiveDoWindowChild(ctx.thread, window);
  return undefined;
}

// ---- onClose hook：拒绝 creator window；其它 do_window 归档子线程 ----

function archiveDoWindowChild(thread: ThreadContext | undefined, window: DoWindow): void {
  if (!thread) return;
  const child = findChild(thread, window.targetThreadId);
  if (!child) return;
  if (child.status === "running" || child.status === "waiting") {
    child.status = "paused";
  }
}

function onCloseDoWindow(ctx: OnCloseContext): boolean | void {
  const window = ctx.window;
  if (window.type !== "do") return;
  if (window.isCreatorWindow) {
    // 拒绝关闭：写一条 inject 提示，避免 LLM 反复尝试
    ctx.thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[close 拒绝] window ${window.id} 是初始 creator do_window，不可关闭（spec § 初始 creator 对话 window）。`,
    });
    return false;
  }
  archiveDoWindowChild(ctx.thread, window);
}

// ---- 注册到 WindowRegistry ----

registerWindowType("do", {
  commands: {
    continue: continueCommand,
    wait: waitCommand,
    close: closeCommand,
  },
  onClose: onCloseDoWindow,
});
