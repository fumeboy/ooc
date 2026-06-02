/**
 * do_window — fork 子线程后在父线程下产生的对话窗口。
 *
 * spec § do_window：
 * - targetThreadId：fork 出的 child thread id；transcript 视图按它过滤 inbox/outbox
 * - 注册的 command：continue / wait / close
 * - close 语义：B=ii archive — 把 child thread 标记为 archived；window 释放
 * - 特殊子类：初始 creator do_window（由 windows/_shared/init.ts 创建），不可被 LLM close
 */

import { registerWindowType, type OnCloseContext, type RenderContext } from "../_shared/registry.js";
import type { CommandKnowledgeEntries, ObjectMethod } from "../_shared/command-types.js";
import {
  ROOT_WINDOW_ID,
  creatorWindowIdOf,
  generateWindowId,
  type ContextWindow,
  type SharingState,
} from "../_shared/types.js";
import type { ThreadPersistenceRef } from "../../../persistable/common.js";
import { continueCommand } from "./command.continue.js";
import { waitCommand } from "./command.wait.js";
import { closeCommand } from "./command.close.js";
import { moveCommand } from "./command.move.js";
import { setTranscriptWindowCommandForDo } from "./command.set-transcript-window.js";
import { archiveDoWindowChild } from "./helpers.js";
import {
  DEFAULT_TRANSCRIPT_VIEWPORT,
  applyTranscriptViewport,
  type TranscriptViewport,
} from "../_shared/transcript-viewport.js";
import { xmlElement, xmlText, type XmlNode } from "../../../thinkable/context/xml.js";
import type { ThreadContext, ThreadMessage } from "../../../thinkable/context.js";
import type { DoWindow } from "./types.js";

/**
 * do_window 的视图过滤：选出与该 window targetThreadId 相关的消息（父 ↔ 子双向）。
 *
 * 全部从 thread.inbox + thread.outbox 拉取，去重后按 createdAt 升序。
 */
export function filterMessagesForDoWindow(window: DoWindow, thread: ThreadContext): ThreadMessage[] {
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

/** do_window 的 renderXml hook：target_thread + creator 标记 + transcript。 */
function renderDoWindow(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as DoWindow;
  const children: XmlNode[] = [
    xmlElement("target_thread", {}, [xmlText(window.targetThreadId)]),
  ];
  if (window.isCreatorWindow) {
    children.push(xmlElement("is_creator_window", {}, [xmlText("true")]));
  }
  const transcriptMessages = filterMessagesForDoWindow(window, ctx.thread);
  const viewport: TranscriptViewport =
    window.transcriptViewport ?? DEFAULT_TRANSCRIPT_VIEWPORT;
  const { visible, earlierCount } = applyTranscriptViewport(
    transcriptMessages,
    viewport,
  );

  const viewportAttrs: Record<string, string> = {
    total: String(transcriptMessages.length),
  };
  if (typeof viewport.tail === "number") {
    viewportAttrs.tail = String(viewport.tail);
  } else if (
    typeof viewport.rangeStart === "number" &&
    typeof viewport.rangeEnd === "number"
  ) {
    viewportAttrs.range_start = String(viewport.rangeStart);
    viewportAttrs.range_end = String(viewport.rangeEnd);
  }
  if (earlierCount > 0) {
    viewportAttrs.earlier_omitted = String(earlierCount);
  }
  children.push(xmlElement("transcript_viewport", viewportAttrs));

  if (visible.length > 0) {
    children.push(
      xmlElement(
        "transcript",
        {},
        visible.map((m) =>
          xmlElement(
            "message",
            { id: m.id, source: m.source },
            [
              xmlElement("from_thread_id", {}, [xmlText(m.fromThreadId)]),
              xmlElement("to_thread_id", {}, [xmlText(m.toThreadId)]),
              xmlElement("content", {}, [xmlText(m.content)]),
            ],
          ),
        ),
      ),
    );
  }
  return children;
}

const DO_TRANSCRIPT_TRUNCATE = 200;

/**
 * do_window 的 compressView hook（design §4.1）。
 *
 * - Level 1 (folded):  target_thread + status + 最近 1 条 transcript 消息(截断到 200 字)
 *   + total_messages 总数
 * - Level 2 (snapshot): target_thread + status + total_messages
 *
 * 设计表格里写 "child status",但 do_window 自身已经有 status 字段(running / archived)——
 * window 外壳已暴露 status;这里把它再以 child_status 子节点显式出来,避免 LLM 漏看。
 */
function compressDoWindow(ctx: RenderContext, level: 1 | 2): XmlNode[] {
  const window = ctx.window as DoWindow;
  const transcript = filterMessagesForDoWindow(window, ctx.thread);
  const children: XmlNode[] = [
    xmlElement("target_thread", {}, [xmlText(window.targetThreadId)]),
    xmlElement("child_status", {}, [xmlText(window.status)]),
    xmlElement("total_messages", {}, [xmlText(String(transcript.length))]),
  ];
  if (window.isCreatorWindow) {
    children.push(xmlElement("is_creator_window", {}, [xmlText("true")]));
  }
  if (level === 1 && transcript.length > 0) {
    const last = transcript[transcript.length - 1]!;
    const content = last.content.slice(0, DO_TRANSCRIPT_TRUNCATE);
    children.push(
      xmlElement(
        "last_message",
        { id: last.id, source: last.source },
        [
          xmlElement("from_thread_id", {}, [xmlText(last.fromThreadId)]),
          xmlElement("to_thread_id", {}, [xmlText(last.toThreadId)]),
          xmlElement("content", {}, [xmlText(content)]),
        ],
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

function onCloseDoWindow(ctx: OnCloseContext): boolean | void {
  const window = ctx.window;
  if (window.type !== "do") return;
  if (window.isCreatorWindow) {
    ctx.thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[close 拒绝] window ${window.id} 是初始 creator do_window，不可关闭（spec § 初始 creator 对话 window）。`,
    });
    return false;
  }
  archiveDoWindowChild(ctx.thread, window);
}

// ─────────────────────────── constructor (P6.§4-§5) ──────────────────────────

const DO_CONSTRUCTOR_BASIC = "internal/objects/do/constructor/basic";
const DO_CONSTRUCTOR_INPUT = "internal/objects/do/constructor/input";

const DO_CONSTRUCTOR_KNOWLEDGE = `
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

function generateThreadId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function makeDoMessage(fromId: string, toId: string, content: string): ThreadMessage {
  return {
    id: generateMessageId(),
    fromThreadId: fromId,
    toThreadId: toId,
    content,
    createdAt: Date.now(),
    source: "do",
  };
}

function deriveChildPersistence(
  parent: ThreadContext,
  childId: string,
): ThreadPersistenceRef | undefined {
  if (!parent.persistence) return undefined;
  return { ...parent.persistence, threadId: childId };
}

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

function deriveDoTitle(msg: string, maxLen = 60): string {
  const trimmed = msg.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}...`;
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

/**
 * P6.§4-§5 constructor —— fork child thread + 创建父侧 do_window。
 *
 * 行为（与历史 root.do 一致）:
 *  1. 校验 msg 非空
 *  2. 生成 childId，构造 child ThreadContext + creator do_window
 *  3. 写消息到 child.inbox + parent.outbox + child.events.inbox_message_arrived
 *  4. 父挂 child（childThreadIds + childThreads + 反向 _parentThreadRef）
 *  5. 构造父侧 do_window —— 由 manager.submit §2 分支调 insertTypedWindow 挂载
 *  6. wait=true 时父进 waiting + inboxSnapshotAtWait
 *  7. share_windows 语法糖：对每个 entry 调 applyInitialShare（mutate parent.contextWindows + child.contextWindows）
 *
 * 返回 { ok: true, object: doWindow }；其余副作用都已在 exec 体内 mutate 完成。
 *
 * 注意 share_windows 是在 parent.contextWindows array 上 in-place mutate;
 * manager 后续 toData() 会从 in-memory windows map 重写 thread.contextWindows,
 * 因此 share_windows 的 lent_out / ref placeholder 必须通过 manager.upsertWindow 写回。
 * 历史实现直接 mutate array；为避免行为变更，constructor 暂保留同样的 mutate 路径,
 * 后续 do_window.move 命令同样依赖此约定。
 */
const doConstructor: ObjectMethod = {
  kind: "constructor",
  paths: ["do", "do.wait"],
  match: (args) => {
    const hit: string[] = ["do"];
    if (args.wait === true) hit.push("do.wait");
    return hit;
  },
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = {
      [DO_CONSTRUCTOR_BASIC]: DO_CONSTRUCTOR_KNOWLEDGE,
    };
    if (formStatus !== "open") return entries;
    if (typeof args.msg !== "string" || args.msg.trim().length === 0) {
      entries[DO_CONSTRUCTOR_INPUT] =
        "do 还缺以下参数: msg。\n" +
        "请用 refine(form_id, args={ msg: \"<给子线程的初始消息>\", wait: true|false }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return entries;
  },
  permission: () => "allow",
  exec: async (ctx) => {
    const parent = ctx.thread;
    if (!parent) return { ok: false, error: "[do] 缺少 thread context。" };

    const content = typeof ctx.args.msg === "string" ? ctx.args.msg : "";
    if (!content) return { ok: false, error: "[do] 缺少 msg 参数。" };
    const wait = ctx.args.wait === true;

    if (ctx.args.knowledge !== undefined || ctx.args.threadId !== undefined) {
      parent.events.push({
        category: "context_change",
        kind: "inject",
        text: "[do] knowledge / threadId 参数在 Step 1 已弃用；threadId 续写改走 do_window.continue，knowledge 待 Step 2 回归。",
      });
    }

    const childId = generateThreadId();
    const initialTitle = deriveDoTitle(content);

    // 1) child thread
    const child: ThreadContext = {
      id: childId,
      status: "running",
      events: [],
      parentThreadId: parent.id,
      creatorThreadId: parent.id,
      contextWindows: buildChildInitialWindows(childId, parent.id, initialTitle),
      persistence: deriveChildPersistence(parent, childId),
    };

    // 2) inbox/outbox + child event
    const message = makeDoMessage(parent.id, childId, content);
    child.inbox = [message];
    child.events.push({
      category: "context_change",
      kind: "inbox_message_arrived",
      msgId: message.id,
    });
    parent.outbox = [...(parent.outbox ?? []), message];

    // 3) parent ↔ child binding
    parent.childThreadIds = [...(parent.childThreadIds ?? []), childId];
    parent.childThreads = { ...(parent.childThreads ?? {}), [childId]: child };
    Object.defineProperty(child, "_parentThreadRef", {
      value: parent,
      enumerable: false,
      writable: true,
      configurable: true,
    });

    // 4) build do_window —— 不在此处 insert,manager.submit §2 分支统一走 insertTypedWindow
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

    // 5) wait
    if (wait) {
      parent.status = "waiting";
      parent.inboxSnapshotAtWait = parent.inbox?.length ?? 0;
    }

    // 6) share_windows 语法糖
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

    return { ok: true, object: doWindow };
  },
};

registerWindowType("do", {
  commands: {
    continue: continueCommand,
    wait: waitCommand,
    close: closeCommand,
    move: moveCommand,
    set_transcript_window: setTranscriptWindowCommandForDo,
    do: doConstructor,
  },
  onClose: onCloseDoWindow,
  renderXml: renderDoWindow,
  compressView: compressDoWindow,
  // P6.§6: do_window 是 Object 内置特性 —— 不写独立 dir，状态 inline 进所属 thread 的 context.json。
  isBuiltinFeature: true,
});
