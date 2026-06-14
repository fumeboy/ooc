/**
 * talk_window — 与"对端某条 thread"保持持续会话。统一两种会话形态（2026-06-14，do_window 并入）：
 *
 * **A. peer 会话（跨对象）**：与另一个 flow object 通信（target=peer objectId / "user"）。
 *    constructor 校验 target stone 存在；`say` 走 talk-delivery 磁盘派送；transcript 按 windowId 过滤。
 * **B. fork 子线程（同对象）**：talk(target=自己 objectId) ⇒ fork 一条新子线程（旧 do）。
 *    `isForkWindow=true`，`targetThreadId`=子线程 id；`say` 走内存树寻址（同 session 同 job、不付磁盘 IO）；
 *    transcript 按 targetThreadId 过滤；支持 `share`（跨 thread 传 window 引用）。
 *
 * 注册的 method：say / wait / close / share / talk(构造) / set_transcript_window。
 * onClose：creator 会话窗（A/B 皆有，指向 caller）不可关闭；fork 子窗 close → archive 子线程。
 */

import { builtinRegistry, type OnCloseContext, type RenderContext } from "../_shared/registry.js";
import type { ObjectMethod } from "../_shared/method-types.js";
import type { MethodCallSchema } from "@ooc/core/_shared/types/intent.js";
import { stat } from "node:fs/promises";
import type { ThreadPersistenceRef } from "../../../persistable/common.js";
import { stoneDir, resolveStoneIdentityRef } from "../../../persistable/index.js";
import { SUPER_ALIAS_TARGET, isTalkLikeClass } from "@ooc/core/_shared/types/constants.js";
import {
  ROOT_WINDOW_ID,
  creatorWindowIdOf,
  generateWindowId,
  type ContextWindow,
  type SharingState,
} from "../_shared/types.js";
import { sayMethod } from "./method.say.js";
import { waitMethod } from "./method.wait.js";
import { closeMethod } from "./method.close.js";
import { shareMethod } from "./method.share.js";
import { archiveForkChild } from "./fork.js";
import { setTranscriptWindowCommandForTalk } from "./method.set-transcript-window.js";
import { DEFAULT_TRANSCRIPT_VIEWPORT } from "../_shared/transcript-viewport.js";
import { renderTranscriptOrHandle } from "../_shared/conversation-render.js";
import { injectMemberWindowsIfObjectThread } from "../_shared/init.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import type { ThreadContext, ThreadMessage } from "../../../thinkable/context.js";
import type { TalkWindow } from "./types.js";

/**
 * talk_window 的视图过滤——两种形态寻址不同：
 * - peer 窗：outbox.windowId === self.id（自己 say 标记）/ inbox.replyToWindowId === self.id（对端回信路由）
 * - fork 子窗：消息按 targetThreadId 双向匹配（父↔子），从 inbox + outbox 拉取去重
 */
export function filterMessagesForTalkWindow(window: TalkWindow, thread: ThreadContext): ThreadMessage[] {
  if (window.isForkWindow) {
    const target = window.targetThreadId;
    const all: ThreadMessage[] = [...(thread.inbox ?? []), ...(thread.outbox ?? [])];
    const seen = new Set<string>();
    const filtered = all.filter((m) => {
      if (seen.has(m.id)) return false;
      if (m.fromThreadId === target || m.toThreadId === target) {
        seen.add(m.id);
        return true;
      }
      return false;
    });
    filtered.sort((a, b) => a.createdAt - b.createdAt);
    return filtered;
  }
  const messages: ThreadMessage[] = [];
  for (const m of thread.outbox ?? []) {
    if (m.windowId === window.id) messages.push(m);
  }
  for (const m of thread.inbox ?? []) {
    if (m.replyToWindowId === window.id) messages.push(m);
  }
  messages.sort((a, b) => a.createdAt - b.createdAt);
  return messages;
}

/** talk_window 的 readable hook：head（peer target / fork target_thread）+ transcript-or-handle。
 *  reflect_request 复用本 hook（同形会话窗），故 export。 */
export function renderTalkWindow(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as TalkWindow;
  const children: XmlNode[] = window.isForkWindow
    ? [xmlElement("target_thread", {}, [xmlText(window.targetThreadId ?? "")])]
    : [
        xmlElement("target", {}, [xmlText(window.target)]),
        xmlElement("conversation_id", {}, [xmlText(window.conversationId)]),
      ];
  // transcript-or-handle（creator 句柄 / 非 creator viewport+transcript）经共享 helper 渲染。
  const messages = filterMessagesForTalkWindow(window, ctx.thread);
  children.push(...renderTranscriptOrHandle(window, messages));
  return children;
}

const TALK_RECENT_COUNT = 2;
const TALK_MESSAGE_TRUNCATE = 200;

/**
 * talk_window 的 compressView hook。
 *
 * - Level 1 (folded):  peer/target_thread + total_messages + 最近 2 条消息(各截断到 200 字)
 * - Level 2 (snapshot): peer/target_thread + total_messages
 */
export function compressTalkWindow(ctx: RenderContext, level: 1 | 2): XmlNode[] {
  const window = ctx.window as TalkWindow;
  const messages = filterMessagesForTalkWindow(window, ctx.thread);
  const children: XmlNode[] = window.isForkWindow
    ? [xmlElement("target_thread", {}, [xmlText(window.targetThreadId ?? "")])]
    : [xmlElement("peer", {}, [xmlText(window.target)])];
  children.push(xmlElement("total_messages", {}, [xmlText(String(messages.length))]));
  if (window.isCreatorWindow) {
    children.push(xmlElement("is_creator_window", {}, [xmlText("true")]));
  }
  if (level === 1 && messages.length > 0) {
    const recent = messages.slice(-TALK_RECENT_COUNT);
    children.push(
      xmlElement(
        "recent_messages",
        { count: String(recent.length) },
        recent.map((m) =>
          xmlElement(
            "message",
            { id: m.id, source: m.source },
            [
              xmlElement("from_thread_id", {}, [xmlText(m.fromThreadId)]),
              xmlElement("to_thread_id", {}, [xmlText(m.toThreadId)]),
              xmlElement("content", {}, [
                xmlText(m.content.slice(0, TALK_MESSAGE_TRUNCATE)),
              ]),
            ],
          ),
        ),
      ),
    );
  }
  children.push(
    xmlElement("compressed", {
      level: String(level),
      hint: "exec(window_id, 'expand') to restore",
    }),
  );
  return children;
}

/** talk_window 的 onClose hook：creator 会话窗不可关闭；fork 子窗 close → archive 子线程。
 *  reflect_request 同形会话窗复用本 hook（isTalkLikeClass 同时认 reflect_request creator 窗），故 export。 */
export function onCloseTalkWindow(ctx: OnCloseContext): boolean | void {
  if (!isTalkLikeClass(ctx.window.class)) return;
  const w = ctx.window as TalkWindow;
  if (w.isCreatorWindow) {
    ctx.thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[close 拒绝] ${ctx.window.class}_window "${w.id}" 是初始 creator 会话窗，与 caller 的恒在通道，不可关闭。`,
      source: "executable/windows/talk#onCloseTalkWindow",
      errorCode: "creator_talk_window_close_rejected",
    });
    return false;
  }
  // fork 子窗 close → archive 对应子线程（旧 do_window onClose 语义并入）。
  if (w.isForkWindow) {
    archiveForkChild(ctx.thread, w);
  }
  return true;
}

// ─────────────────────────── constructor ──────────────────────────

const TALK_CONSTRUCTOR_TIP = `talk 开启一个持续会话 talk_window。
- target=别的 objectId（"user" 也是）⇒ peer 跨对象会话。
- target=自己的 objectId ⇒ fork 一条同对象子线程（旧 do）。
参数：target（必填）、title（fork 形态用 msg 也可）。fork 形态额外支持 wait / share_windows。`;

function deriveTalkTitle(raw: string, max = 60): string {
  const trimmed = raw.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`;
}

// ── fork 子线程构造（旧 do constructor 并入） ──────────────────────────────

function generateThreadId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function makeForkMessage(fromId: string, toId: string, content: string): ThreadMessage {
  return {
    id: generateMessageId(),
    fromThreadId: fromId,
    toThreadId: toId,
    content,
    createdAt: Date.now(),
    source: "talk",
  };
}

function deriveChildPersistence(
  parent: ThreadContext,
  childId: string,
): ThreadPersistenceRef | undefined {
  if (!parent.persistence) return undefined;
  return { ...parent.persistence, threadId: childId };
}

function buildChildCreatorWindow(
  childId: string,
  parentThreadId: string,
  selfObjectId: string,
  initialTitle: string,
): TalkWindow {
  return {
    id: creatorWindowIdOf(childId),
    class: "talk",
    parentWindowId: ROOT_WINDOW_ID,
    title: initialTitle,
    status: "open",
    createdAt: Date.now(),
    target: selfObjectId,
    targetThreadId: parentThreadId,
    isForkWindow: true,
    conversationId: creatorWindowIdOf(childId),
    isCreatorWindow: true,
    state: { transcriptViewport: { ...DEFAULT_TRANSCRIPT_VIEWPORT } },
  };
}

interface ShareWindowEntry {
  window_id: string;
  mode: "readonly-ref" | "move";
}

function parseShareWindows(raw: unknown): ShareWindowEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const result: ShareWindowEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const wid = (item as { window_id?: unknown }).window_id;
    const mode = (item as { mode?: unknown }).mode;
    if (typeof wid !== "string" || (mode !== "readonly-ref" && mode !== "move")) continue;
    result.push({ window_id: wid, mode });
  }
  return result;
}

function applyInitialShare(
  parent: ThreadContext,
  child: ThreadContext,
  forkWindow: TalkWindow,
  entry: ShareWindowEntry,
): string | undefined {
  const parentWindows = parent.contextWindows ?? [];
  const sourceIdx = parentWindows.findIndex((w) => w.id === entry.window_id);
  if (sourceIdx < 0) {
    return `window "${entry.window_id}" 不在父 thread.contextWindows 里`;
  }
  const source = parentWindows[sourceIdx]!;
  if (source.sharing) {
    return `window "${entry.window_id}" 已是 sharing 状态，不能再传`;
  }
  if (source.class === "talk" || source.class === "method_exec" || source.class === "root") {
    return `window "${entry.window_id}" 是 ${source.class} 类型，不允许传`;
  }

  const childWindows = child.contextWindows ?? (child.contextWindows = []);
  if (childWindows.some((w) => w.id === entry.window_id)) {
    return `子 thread 已有同 id window "${entry.window_id}"`;
  }

  const snapshot: ContextWindow = JSON.parse(JSON.stringify(source));
  delete (snapshot as { sharing?: SharingState }).sharing;

  if (entry.mode === "readonly-ref") {
    const refPlaceholder: ContextWindow = {
      ...snapshot,
      sharing: {
        kind: "readonly-ref",
        ownerThreadId: parent.id,
        lentByWindowId: forkWindow.id,
        sharedAt: Date.now(),
        snapshot,
      },
    };
    child.contextWindows = [...childWindows, refPlaceholder];
    return undefined;
  }

  // mode=move
  const shadow: ContextWindow = {
    ...snapshot,
    sharing: {
      kind: "mutable-ref",
      borrowerThreadId: child.id,
      lentToWindowId: forkWindow.id,
      sharedAt: Date.now(),
      snapshot,
    },
  };
  parentWindows[sourceIdx] = shadow;
  parent.contextWindows = parentWindows;

  const ownerCopy: ContextWindow = JSON.parse(JSON.stringify(source));
  delete (ownerCopy as { sharing?: SharingState }).sharing;
  child.contextWindows = [...childWindows, ownerCopy];
  return undefined;
}

/**
 * fork 形态 —— talk(target=自己) 派生子线程 + 创建父侧 fork 子窗（isForkWindow=true）。
 *
 * 1) 校验 msg 非空（fork 形态用 msg 作子线程初始消息）
 * 2) 生成 childId，构造 child ThreadContext + creator fork 窗（指向父）
 * 3) 写消息到 child.inbox + parent.outbox + child.events.inbox_message_arrived
 * 4) 父挂 child（childThreadIds + childThreads + 反向 _parentThreadRef）
 * 5) wait=true 时父进 waiting + inboxSnapshotAtWait
 * 6) share_windows 语法糖：对每个 entry 调 applyInitialShare
 * 返回 { ok: true, window: forkWindow }（manager.submit 分支 insertTypedWindow 挂载）。
 */
async function execFork(
  ctx: import("../_shared/method-types.js").MethodExecutionContext,
  selfObjectId: string,
): Promise<import("../_shared/method-types.js").MethodOutcome> {
  const parent = ctx.thread;
  if (!parent) return { ok: false, error: "[talk] 缺少 thread context。" };

  const content = typeof ctx.args.msg === "string" ? ctx.args.msg : "";
  if (!content) {
    return { ok: false, error: "[talk] fork（target=自己）形态缺少 msg 参数（给子线程的初始消息）。" };
  }
  const wait = ctx.args.wait === true;

  const childId = generateThreadId();
  const initialTitle = deriveTalkTitle(content);

  const child: ThreadContext = {
    id: childId,
    status: "running",
    events: [],
    parentThreadId: parent.id,
    creatorThreadId: parent.id,
    creatorObjectId: selfObjectId,
    contextWindows: [buildChildCreatorWindow(childId, parent.id, selfObjectId, initialTitle)],
    persistence: deriveChildPersistence(parent, childId),
  };

  // fork 子线程是同 object 的 sub-thread——继承该 object 声明持有的 tool-object 成员（如 filesystem），
  // 否则子 agent 无法用工具。scheduler 直接驱动内存子线程、不走 readThread，故在此显式注入（IO 失败静默吞）。
  await injectMemberWindowsIfObjectThread(child);

  const message = makeForkMessage(parent.id, childId, content);
  child.inbox = [message];
  child.events.push({
    category: "context_change",
    kind: "inbox_message_arrived",
    msgId: message.id,
  });
  parent.outbox = [...(parent.outbox ?? []), message];

  parent.childThreadIds = [...(parent.childThreadIds ?? []), childId];
  parent.childThreads = { ...(parent.childThreads ?? {}), [childId]: child };
  Object.defineProperty(child, "_parentThreadRef", {
    value: parent,
    enumerable: false,
    writable: true,
    configurable: true,
  });

  const forkWindow: TalkWindow = {
    id: generateWindowId("talk"),
    class: "talk",
    parentWindowId: ROOT_WINDOW_ID,
    title: initialTitle,
    status: "open",
    createdAt: Date.now(),
    target: selfObjectId,
    targetThreadId: childId,
    isForkWindow: true,
    conversationId: "",
    state: { transcriptViewport: { ...DEFAULT_TRANSCRIPT_VIEWPORT } },
  };
  forkWindow.conversationId = forkWindow.id;

  if (wait) {
    parent.status = "waiting";
    parent.inboxSnapshotAtWait = parent.inbox?.length ?? 0;
  }

  const shareWindows = parseShareWindows(ctx.args.share_windows);
  if (shareWindows && shareWindows.length > 0) {
    const errors: string[] = [];
    for (const entry of shareWindows) {
      const result = applyInitialShare(parent, child, forkWindow, entry);
      if (result) errors.push(result);
    }
    if (errors.length > 0) {
      parent.events.push({
        category: "context_change",
        kind: "inject",
        text: `[talk.share_windows] 部分传递失败：\n${errors.join("\n")}`,
        source: "executable/windows/talk#talk.execFork",
        errorCode: "share_windows_partial_failure",
      });
    }
  }

  return { ok: true, window: forkWindow };
}

/**
 * constructor —— 创建 talk_window。target=自己 objectId ⇒ fork 子线程；否则 peer 会话。
 *
 * peer 形态：校验 target / title 必填 + target stone 存在；不在此发消息（首条走 say）。
 * fork 形态：见 execFork（msg 必填、wait / share_windows 可选）。
 */
export const talkConstructor: ObjectMethod = {
  kind: "constructor",
  description: "Open a talk_window: target=another object ⇒ peer conversation; target=self ⇒ fork a child thread.",
  intents: ["talk", "talk.wait"],
  permission: () => "allow",
  schema: {
    args: {
      target: { type: "string", required: true, description: '目标 objectId（别的对象 / "user" ⇒ peer 会话；自己的 objectId ⇒ fork 子线程）' },
      title: { type: "string", required: false, description: "peer 会话主题（peer 形态必填）" },
      msg: { type: "string", required: false, description: "fork 子线程初始消息（fork 形态必填）" },
      wait: { type: "boolean", required: false, default: false, description: "（fork）true 时父线程立刻进入 waiting，等子线程回写" },
      share_windows: { type: "array", required: false, description: '（fork）随子线程一并传的 windows，每条形如 { window_id, mode: "readonly-ref" | "move" }' },
    },
  } as MethodCallSchema,
  onFormChange(change, { args }) {
    const target = typeof args.target === "string" ? args.target.trim() : "";
    const hasTitle = typeof args.title === "string" && args.title.trim().length > 0;
    const hasMsg = typeof args.msg === "string" && args.msg.trim().length > 0;
    // 目标是自己 ⇒ fork（要 msg）；否则 peer（要 title）。target 缺省时按 peer 提示。
    const ready = Boolean(target) && (hasTitle || hasMsg);
    const intents = args.wait === true ? [{ name: "talk.wait" }] : [{ name: "talk" }];
    return {
      tip: ready ? `Opening talk to ${target}...` : TALK_CONSTRUCTOR_TIP,
      intents,
      quick_exec_submit: ready,
    };
  },
  exec: async (ctx) => {
    const thread = ctx.thread;
    if (!thread) return { ok: false, error: "[talk] 缺少 thread context。" };
    const target = typeof ctx.args.target === "string" ? ctx.args.target.trim() : "";
    if (!target) return { ok: false, error: "[talk] 缺少 target 参数。" };

    const selfObjectId = thread.persistence?.objectId;
    // fork 形态：target=自己 objectId ⇒ 派生同对象子线程（旧 do）。
    if (selfObjectId && target === selfObjectId) {
      return execFork(ctx, selfObjectId);
    }

    // peer 形态：跨对象会话。
    const title = typeof ctx.args.title === "string" ? deriveTalkTitle(ctx.args.title) : "";
    if (!title) return { ok: false, error: "[talk] peer 会话缺少 title 参数。" };

    if (target !== SUPER_ALIAS_TARGET && thread.persistence?.baseDir) {
      const stoneRef = await resolveStoneIdentityRef(
        {
          baseDir: thread.persistence.baseDir,
          sessionId: thread.persistence.sessionId,
          objectId: target,
        },
        "read",
      );
      const dir = stoneDir(stoneRef);
      let exists = false;
      try {
        const info = await stat(dir);
        exists = info.isDirectory();
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      if (!exists) {
        return {
          ok: false,
          error: `[talk] target \`${target}\` 不存在(本 session worktree 与 main canonical 均未找到该对象目录)。请检查 target 拼写是否正确;若是新对象,先 create_object 再 open talk_window。`,
        };
      }
    }

    const id = generateWindowId("talk");
    const talkWindow: TalkWindow = {
      id,
      class: "talk",
      parentWindowId: ROOT_WINDOW_ID,
      title,
      status: "open",
      createdAt: Date.now(),
      target,
      conversationId: id,
      state: { transcriptViewport: { ...DEFAULT_TRANSCRIPT_VIEWPORT } },
    };
    return { ok: true, window: talkWindow };
  },
};

builtinRegistry.registerExecutable("talk", {
  methods: {
    say: sayMethod,
    wait: waitMethod,
    close: closeMethod,
    share: shareMethod,
    talk: talkConstructor,
  },
  // talk_window 是 Object 内置特性 —— 不写独立 dir，状态 inline 进所属 thread 的 context.json。
  isBuiltinFeature: true,
});
builtinRegistry.registerReadable("talk", {
  windowMethods: {
    set_transcript_window: setTranscriptWindowCommandForTalk,
  },
  onClose: onCloseTalkWindow,
  readable: renderTalkWindow,
  compressView: compressTalkWindow,
  // G4: registry 派发的去重 hook —— 复用 filterMessagesForTalkWindow。
  consumedMessageIds: (ctx) =>
    filterMessagesForTalkWindow(ctx.window as TalkWindow, ctx.thread),
});
