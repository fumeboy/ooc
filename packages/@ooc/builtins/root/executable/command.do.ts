/**
 * root.do command — fork 子线程并产出一个 do_window。
 *
 * spec § do_window：
 * - submit 副作用：
 *   1. 创建 child thread（生成 id、派生 persistence ref）
 *   2. 在父 thread.contextWindows 下挂一个 type=do 的 window，targetThreadId=childId
 *   3. 在 child.contextWindows 下挂初始 creator do_window（指向父）
 *   4. 写 child inbox + 父 outbox + 在 child 记 inbox_message_arrived 事件
 *   5. wait=true 则父进入 status="waiting"
 * - root.do 不再支持 context="continue"；continue 改走 do_window 上的 continue command
 *
 * 旧的 context="continue" / context="fork" 区分被取消（spec 简化模型）。
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "@ooc/core/extendable/_shared/command-types.js";
import type { ThreadContext, ThreadMessage } from "@ooc/core/thinkable/context.js";
import type { ThreadPersistenceRef } from "@ooc/core/persistable/common.js";
import {
  ROOT_WINDOW_ID,
  creatorWindowIdOf,
  generateWindowId,
  type ContextWindow,
  type DoWindow,
  type SharingState,
} from "@ooc/core/extendable/_shared/types.js";
import { DEFAULT_TRANSCRIPT_VIEWPORT } from "@ooc/core/extendable/_shared/transcript-viewport.js";

const DO_BASIC_PATH = "internal/executable/do/basic";
const DO_INPUT_PATH = "internal/executable/do/input";

const KNOWLEDGE = `
do 用于在当前对象内部派生子线程，并在父线程下产生一个 do_window 用于后续与子线程交互。

参数：
- msg: 必填，写入子线程 inbox 的初始消息
- wait: 可选，true 时父线程立刻进入 waiting，等子线程回写消息再唤醒
- share_windows: 可选，要在子线程创建时一并分享的 windows 列表，每条形如
  { window_id: "<id>", mode: "ref" | "move" }；ref = 只读 snapshot；move = 移交所有权
  内部展开为多次 do_window.move 命令；之后还可以随时通过 do_window.move 继续分享/归还

示例：
exec(command="do", title="处理告警", args={ msg: "请检查 ERROR 日志", wait: true })
exec(command="do", title="一起读 file_x", args={
  msg: "看 file_x 第 100-200 行",
  share_windows: [{ window_id: "w_file_abc", mode: "ref" }]
})

submit 后：
- 子线程创建并 running；初始消息进 child inbox
- 父线程下挂 do_window（type=do, targetThreadId=<childId>）
- 后续追加消息：exec(window_id="<do_window_id>", command="continue", args={ msg: "..." })
- 后续分享 window：exec(window_id="<do_window_id>", command="move", args={ window_id, mode })
- 关闭对话：close(window_id="<do_window_id>")（子线程会被标记 archived；borrowed owner 自动归还）
`.trim();

export enum DoCommandPath {
  Do = "do",
  Wait = "do.wait",
}

/** root level 的 do command：仅 fork。continue 走 do_window 上的命令。 */
export const doCommand: CommandTableEntry = {
  paths: [DoCommandPath.Do, DoCommandPath.Wait],
  match: (args) => {
    const hit: string[] = [DoCommandPath.Do];
    if (args.wait === true) hit.push(DoCommandPath.Wait);
    return hit;
  },
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [DO_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    if (typeof args.msg !== "string" || args.msg.trim().length === 0) {
      entries[DO_INPUT_PATH] =
        "do 还缺以下参数: msg。\n" +
        "请用 refine(form_id, args={ msg: \"<给子线程的初始消息>\", wait: true|false }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return entries;
  },
  exec: (ctx) => executeDoCommand(ctx),
};

// ---- helpers ----

function generateThreadId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

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

/** 派生 child 的 persistence ref：baseDir/sessionId/objectId 沿用父；threadId=childId。 */
function deriveChildPersistence(
  parent: ThreadContext,
  childId: string,
): ThreadPersistenceRef | undefined {
  if (!parent.persistence) return undefined;
  return { ...parent.persistence, threadId: childId };
}

/**
 * 为新 child thread 构造初始 contextWindows：
 *
 * 包含一个指向父 thread 的 creator do_window（spec § 初始 creator 对话 window）。
 * id 派生稳定（creatorWindowIdOf）；isCreatorWindow=true，不可被关闭。
 */
function buildChildInitialWindows(
  childId: string,
  parentThreadId: string,
  initialTitle: string,
): DoWindow[] {
  const creatorWindow: DoWindow = {
    id: creatorWindowIdOf(childId),
    type: "do",
    parentWindowId: ROOT_WINDOW_ID,
    title: initialTitle,
    status: "running",
    createdAt: Date.now(),
    targetThreadId: parentThreadId,
    isCreatorWindow: true,
    transcriptViewport: { ...DEFAULT_TRANSCRIPT_VIEWPORT },
  };
  return [creatorWindow];
}

/** 截断 title，避免过长污染 context。 */
function deriveTitle(msg: string, maxLen = 60): string {
  const trimmed = msg.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}...`;
}

/**
 * root.do 执行入口：fork child thread + 创建父侧 do_window。
 *
 * 注意：do_window 的插入靠 mutate ctx.thread.contextWindows，因为 WindowManager.submit
 * 在 entry.exec 完成后会调用 toData() 重写 thread.contextWindows——所以这里直接 push 即可，
 * 与 WindowManager 维护的内存映射保持一致由调用层串起来。
 *
 * Step 1 限制：args.knowledge / args.threadId 不再支持。如收到这些参数会被忽略并写一条 inject。
 */
export async function executeDoCommand(ctx: CommandExecutionContext): Promise<string | undefined> {
  const parent = ctx.thread;
  if (!parent) return "[do] 缺少 thread context。";

  const content = typeof ctx.args.msg === "string" ? ctx.args.msg : "";
  if (!content) return "[do] 缺少 msg 参数。";
  const wait = ctx.args.wait === true;

  // Step 1 限制提示
  if (ctx.args.knowledge !== undefined || ctx.args.threadId !== undefined) {
    parent.events.push({
      category: "context_change",
      kind: "inject",
      text: "[do] knowledge / threadId 参数在 Step 1 已弃用；threadId 续写改走 do_window.continue，knowledge 待 Step 2 回归。",
    });
  }

  const childId = generateThreadId();
  const initialTitle = deriveTitle(content);

  // 1) 构造 child thread
  const child: ThreadContext = {
    id: childId,
    status: "running",
    events: [],
    parentThreadId: parent.id,
    creatorThreadId: parent.id,
    contextWindows: buildChildInitialWindows(childId, parent.id, initialTitle),
    persistence: deriveChildPersistence(parent, childId),
  };

  // 2) 写消息到 child inbox + 父 outbox + 子事件流
  const message = makeMessage(parent.id, childId, content);
  child.inbox = [message];
  child.events.push({
    category: "context_change",
    kind: "inbox_message_arrived",
    msgId: message.id,
  });
  parent.outbox = [...(parent.outbox ?? []), message];

  // 3) 把 child 挂到父线程树（双向引用：parent.childThreads + child._parentThreadRef）
  parent.childThreadIds = [...(parent.childThreadIds ?? []), childId];
  parent.childThreads = { ...(parent.childThreads ?? {}), [childId]: child };
  // 反向引用：仅运行时使用，不持久化（thread.json strip）；用于 do_window.move 等
  // 命令从子 thread 访问父 thread。
  Object.defineProperty(child, "_parentThreadRef", {
    value: parent,
    enumerable: false,
    writable: true,
    configurable: true,
  });

  // 4) 在父线程下挂一个 do_window 指向 child
  const doWindow: DoWindow = {
    id: generateWindowId("do"),
    type: "do",
    parentWindowId: ROOT_WINDOW_ID,
    title: initialTitle,
    status: "running",
    createdAt: Date.now(),
    targetThreadId: childId,
    transcriptViewport: { ...DEFAULT_TRANSCRIPT_VIEWPORT },
  };
  if (ctx.manager) {
    ctx.manager.insertTypedWindow(doWindow, ctx.thread);
  } else {
    parent.contextWindows = [...(parent.contextWindows ?? []), doWindow];
  }

  // 5) wait=true 时父线程进入 waiting；scheduler 见 inbox 新消息后唤醒
  if (wait) {
    parent.status = "waiting";
    parent.inboxSnapshotAtWait = parent.inbox?.length ?? 0;
  }

  // 6) share_windows 语法糖：按顺序对每个条目模拟 do_window.move（plan §do_window.move）
  const shareWindows = parseShareWindows(ctx.args.share_windows);
  if (shareWindows && shareWindows.length > 0) {
    const errors: string[] = [];
    for (const entry of shareWindows) {
      const result = applyInitialShare(parent, child, doWindow, entry);
      if (result) errors.push(result);
    }
    if (errors.length > 0) {
      parent.events.push({
        category: "context_change",
        kind: "inject",
        text: `[do.share_windows] 部分分享失败：\n${errors.join("\n")}`,
      });
    }
  }

  return undefined;
}

interface ShareWindowEntry {
  window_id: string;
  mode: "ref" | "move";
}

function parseShareWindows(raw: unknown): ShareWindowEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const result: ShareWindowEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const wid = (item as { window_id?: unknown }).window_id;
    const mode = (item as { mode?: unknown }).mode;
    if (typeof wid !== "string" || (mode !== "ref" && mode !== "move")) continue;
    result.push({ window_id: wid, mode });
  }
  return result;
}

/**
 * root.do 创建子线程时的初始分享：直接在父→子方向上 transfer。
 *
 * 复用 do_window.move 的同等语义：
 * - mode=ref：子追加 ref placeholder + snapshot；父 owner 不变
 * - mode=move：父 owner → lent_out（含 snapshot）；子追加完整 owner 副本
 *
 * 错误形式 → 返回 string；成功 → 返回 undefined
 */
function applyInitialShare(
  parent: ThreadContext,
  child: ThreadContext,
  doWindow: DoWindow,
  entry: ShareWindowEntry,
): string | undefined {
  const parentWindows = parent.contextWindows ?? [];
  const sourceIdx = parentWindows.findIndex((w) => w.id === entry.window_id);
  if (sourceIdx < 0) {
    return `window "${entry.window_id}" 不在父 thread.contextWindows 里`;
  }
  const source = parentWindows[sourceIdx]!;
  if (source.sharing) {
    return `window "${entry.window_id}" 已是 sharing 状态，不能再分享`;
  }
  if (source.type === "do" || source.type === "command_exec" || source.type === "root") {
    return `window "${entry.window_id}" 是 ${source.type} 类型，不允许分享`;
  }

  const childWindows = child.contextWindows ?? (child.contextWindows = []);
  if (childWindows.some((w) => w.id === entry.window_id)) {
    return `子 thread 已有同 id window "${entry.window_id}"`;
  }

  const snapshot: ContextWindow = JSON.parse(JSON.stringify(source));
  delete (snapshot as { sharing?: SharingState }).sharing;

  if (entry.mode === "ref") {
    const refPlaceholder: ContextWindow = {
      ...snapshot,
      sharing: {
        kind: "ref",
        ownerThreadId: parent.id,
        lentByWindowId: doWindow.id,
        sharedAt: Date.now(),
        snapshot,
      },
    };
    child.contextWindows = [...childWindows, refPlaceholder];
    return undefined;
  }

  // mode=move
  const lentOut: ContextWindow = {
    ...snapshot,
    sharing: {
      kind: "lent_out",
      borrowerThreadId: child.id,
      lentToWindowId: doWindow.id,
      sharedAt: Date.now(),
      snapshot,
    },
  };
  parentWindows[sourceIdx] = lentOut;
  parent.contextWindows = parentWindows;

  const ownerCopy: ContextWindow = JSON.parse(JSON.stringify(source));
  delete (ownerCopy as { sharing?: SharingState }).sharing;
  child.contextWindows = [...childWindows, ownerCopy];
  return undefined;
}
