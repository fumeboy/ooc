/**
 * fork —— 同对象子线程的 **caller-side wiring**。
 *
 * `threadConstructor` 纯化后只产新线程、不掏父；本函数承接 fork 形态的调用方副作用：
 * 经 `buildThread` 造子线程（含初始窗 + creator 通道 isFork=true）→ 投初始消息（child.inbox +
 * parent.outbox）→ 父挂子（childThreadIds / childThreads / _parentThreadRef，scheduler 同 job 内跑）
 * → wait 时父进 waiting。**不**在父侧建可见 fork 会话窗（summarizer 内部 fork 不需要；agent.talk
 * 的 fork 另行加父侧窗）。
 *
 * 用于：agent.talk（target=自己）的 fork 形态、compress summarizer fork。
 */

import { buildThread } from "../thinkable/context/init-windows.js";
import { makeMessage, appendInbox } from "./talk-fork.js";
import type { ThreadContext, ThreadMessage } from "@ooc/builtins/agent/thread/types.js";

export interface OpenForkChildOpts {
  /** 父/子所属对象 id（同对象 fork）。 */
  selfObjectId: string;
  /** 给子线程的初始消息。 */
  msg: string;
  /** true ⇒ 父线程立刻进入 waiting，等子线程回写。 */
  wait?: boolean;
  /** compress v2：标记 framework summarizer 子线程。 */
  summarizer?: boolean;
  /** 子线程初始标题。 */
  title?: string;
}

/**
 * fork 一条同对象子线程并完成父侧 wiring。返回新建的子线程。
 */
export function openForkChild(parent: ThreadContext, opts: OpenForkChildOpts): ThreadContext {
  const child = buildThread({
    objectId: opts.selfObjectId,
    callerThreadId: parent.id,
    callerObjectId: opts.selfObjectId,
    isFork: true,
    title: opts.title,
    persistence: parent.persistence,
    summarizer: opts.summarizer,
  });
  child.parentThreadId = parent.id;

  // 投初始消息：child.inbox + parent.outbox。
  const message: ThreadMessage = makeMessage(parent.id, child.id, opts.msg);
  appendInbox(child, message);
  parent.outbox = [...(parent.outbox ?? []), message];

  // 父挂子（内存线程树，scheduler 同 job 内轮询）。
  parent.childThreadIds = [...(parent.childThreadIds ?? []), child.id];
  parent.childThreads = { ...(parent.childThreads ?? {}), [child.id]: child };
  Object.defineProperty(child, "_parentThreadRef", {
    value: parent,
    enumerable: false,
    writable: true,
    configurable: true,
  });

  if (opts.wait) {
    parent.status = "waiting";
    parent.inboxSnapshotAtWait = parent.inbox?.length ?? 0;
  }

  return child;
}
