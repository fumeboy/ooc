/**
 * 单元测试用 thread fixture — 构造一个最小可运行的 ThreadContext。
 *
 * Step 1 重构后 ThreadContext.contextWindows 必填；不少老测试用对象字面量直接 new 一个 thread，
 * 通过这个 helper 集中处理 contextWindows 的初始化（含 creator talk_window 注入）。
 */
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import type { ThreadPersistenceRef } from "../persistable/common";
import type { OocObjectRef } from "../runtime/ooc-class";
import { initThreadContextWindows } from "@ooc/builtins/agent/thread/thinkable/context/init-windows.js";
import { setSessionObject } from "@ooc/core/runtime/session-object-table.js";

export interface MakeThreadOpts {
  id?: string;
  /** 测试用：快捷设置 thread.persistence.objectId；与 persistence 同时指定时 persistence 优先。 */
  objectId?: string;
  status?: ThreadContext["status"];
  parentThreadId?: string;
  creatorThreadId?: string;
  /** 见 ThreadContext.creatorObjectId;cross-object talk 测试需要构造它。 */
  creatorObjectId?: string;
  persistence?: ThreadPersistenceRef;
  /** 初始 events，会原样写入 thread.events。 */
  events?: ThreadContext["events"];
  /** 初始 inbox/outbox。 */
  inbox?: ThreadContext["inbox"];
  outbox?: ThreadContext["outbox"];
  /** 初始 contextWindows（除自动注入的 creator window 外的额外 window）。 */
  extraWindows?: ThreadContext["contextWindows"];
  /** creator window 的 title；缺省 = "test-thread"。 */
  title?: string;
  /** 跳过自动 creator talk_window 注入（当测试明确不想要时）。 */
  skipCreatorWindow?: boolean;
}

/**
 * 构造一个测试用 ThreadContext。
 *
 * 默认行为：
 * - id="t_root"
 * - status="running"
 * - events=[]
 * - contextWindows=[creator talk_window]
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
    creatorObjectId: opts.creatorObjectId,
    inbox: opts.inbox,
    outbox: opts.outbox,
    contextWindows: [],
    persistence: opts.persistence,
  };
  // B→A：归一化 extraWindows——带旧形态 `.object={class,data}` 的 cast-hidden 窗，把 data 登记进
  // session 对象表、窗归一化为纯 ref（id/class/视角态）；已是 ref（无 .object）的原样保留。
  if (opts.extraWindows) {
    thread.contextWindows = opts.extraWindows.map((w) => {
      const legacy = w as unknown as { id: string; object?: { class: string; data: unknown } };
      if (legacy.object) {
        setSessionObject(thread, {
          id: legacy.id,
          class: legacy.object.class,
          data: legacy.object.data,
        });
        const { object: _object, ...view } = legacy;
        return { ...(view as object), class: legacy.object.class } as OocObjectRef;
      }
      return w;
    });
  }
  if (!opts.skipCreatorWindow) {
    // 兼容老单元测试默认行为：注入一个指向 placeholder parent 的 creator talk_window。
    // 产品端 initThreadContextWindows 现在要求"真有 creator info"才注入（避免 phantom），
    // 所以这里显式给个 placeholder thread id（即使是假的，对单元测试来说也是合理 stub）。
    initThreadContextWindows(thread, {
      callerThreadId: opts.creatorThreadId ?? "t_test_creator",
      title: opts.title ?? "test-thread",
    });
  }
  return thread;
}
