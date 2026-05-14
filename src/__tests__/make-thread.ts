/**
 * 单元测试用 thread fixture — 构造一个最小可运行的 ThreadContext。
 *
 * Step 1 重构后 ThreadContext.contextWindows 必填；不少老测试用对象字面量直接 new 一个 thread，
 * 通过这个 helper 集中处理 contextWindows 的初始化（含 creator do_window 注入）。
 */
import type { ThreadContext } from "../thinkable/context";
import type { ThreadPersistenceRef } from "../persistable/common";
import { initContextWindows } from "../executable/windows";

export interface MakeThreadOpts {
  id?: string;
  status?: ThreadContext["status"];
  parentThreadId?: string;
  creatorThreadId?: string;
  persistence?: ThreadPersistenceRef;
  /** 初始 events，会原样写入 thread.events。 */
  events?: ThreadContext["events"];
  /** 初始 inbox/outbox。 */
  inbox?: ThreadContext["inbox"];
  outbox?: ThreadContext["outbox"];
  /** 初始 contextWindows（除自动注入的 creator window 外的额外 window）。 */
  extraWindows?: ThreadContext["contextWindows"];
  /** creator window 的 title；缺省 = "test-thread"。 */
  initialTaskTitle?: string;
  /** 跳过自动 creator do_window 注入（当测试明确不想要时）。 */
  skipCreatorWindow?: boolean;
}

/**
 * 构造一个测试用 ThreadContext。
 *
 * 默认行为：
 * - id="t_root"
 * - status="running"
 * - events=[]
 * - contextWindows=[creator do_window]
 *
 * 调用方可以通过 opts 覆盖任意字段。
 */
export function makeThread(opts: MakeThreadOpts = {}): ThreadContext {
  const thread: ThreadContext = {
    id: opts.id ?? "t_root",
    status: opts.status ?? "running",
    events: opts.events ?? [],
    parentThreadId: opts.parentThreadId,
    creatorThreadId: opts.creatorThreadId,
    inbox: opts.inbox,
    outbox: opts.outbox,
    contextWindows: opts.extraWindows ? [...opts.extraWindows] : [],
    persistence: opts.persistence,
  };
  if (!opts.skipCreatorWindow) {
    initContextWindows(thread, {
      creatorThreadId: opts.creatorThreadId,
      initialTaskTitle: opts.initialTaskTitle ?? "test-thread",
    });
  }
  return thread;
}
