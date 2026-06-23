/**
 * 初始 contextWindows 铺设 —— thread `construct` 出生 + restore 恢复共用的**纯函数**窗工厂。
 *
 * 取代旧 `init.ts`：self 门面窗 / 自我视角 thread 过程窗（creator 通道）/ 全局单例工具成员窗在此
 * 同步铺设（零 IO、幂等）；peer（sibling/children）窗属环境发现，由 `peer-windows.ts` 创建期 eager
 * 注入 + buildInputItems 每轮 reconcile 兜底。construct（`index.ts threadConstructor`）调本函数。
 */

import { ROOT_WINDOW_ID, threadWindowIdOf } from "@ooc/core/_shared/types/context-window.js";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import { materializeWindow } from "@ooc/core/runtime/session-object-table.js";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import type { ThreadPersistenceRef, ThreadStatus } from "@ooc/core/_shared/types/thread.js";

export function generateThreadId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 每条 agent thread 初始 context 默认补充的**全局单例工具成员**（composition HAS-A 默认成员）：
 * filesystem / terminal / interpreter / knowledge_base / runtime 全局单例 tool-object + skill_index。
 *
 * agent 一开窗即可 exec 这些工具、看见技能索引。member 窗 transient 重注入（不持久化），每次
 * thread construct / restore 幂等补齐。（旧 `ooc.members` 包级声明已退役、全仓无任何声明，故不再读盘。）
 */
export const GLOBAL_SINGLETON_TOOL_MEMBERS = [
  "_builtin/filesystem",
  "_builtin/terminal",
  "_builtin/interpreter",
  "_builtin/knowledge_base",
  "_builtin/runtime",
  "_builtin/agent/skill_index",
] as const;

export interface ThreadWindowInitOpts {
  /** 本线程所属对象 id；缺省回落 `thread.persistence?.objectId`。"user" 不注入 self/member 窗。 */
  objectId?: string;
  /** 创建本线程的线程 id（creator 通道）；缺省回落 `thread.creatorThreadId`。 */
  callerThreadId?: string;
  /** 创建本线程的对象 id（creator 通道）；缺省回落 `thread.creatorObjectId`。 */
  callerObjectId?: string;
  /**
   * fork（同对象子窗）vs peer（跨对象会话窗）判定 override。知 session 的调用方（restore /
   * talk-delivery）传入正确值（同对象**且同 session** 才 fork——super-alias 跨 session 同对象=peer）；
   * 纯构造器缺省时回落 `callerObjectId === objectId` 的对象级比较。
   */
  isFork?: boolean;
  /** 初始任务标题；作为自我视角 thread 窗的 title。 */
  title?: string;
}

/**
 * **初始 contextWindows 铺设**（幂等）—— construct 出生 + restore 恢复共用。
 *
 * 写入：
 * 1. self 门面窗（id = objectId）：对象的「自我门面」，agency 方法经 renderer isSelf 门控 surface。
 * 2. 自我视角 thread 过程窗（id = threadWindowIdOf(thread.id)）：承载 thread.events transcript +
 *    **creator 通道**（target / targetThreadId / isForkWindow，从 caller 身份派生）。
 * 3. 全局单例工具成员窗（filesystem / terminal / interpreter / knowledge_base / runtime / skill_index）。
 *
 * 全 transient（不单独落 data.json）；幂等（按 id 去重）；纯函数、零 IO。
 */
export function initThreadContextWindows(
  thread: ThreadContext,
  opts: ThreadWindowInitOpts = {},
): void {
  const list = thread.contextWindows ?? (thread.contextWindows = []);
  const existing = new Set(list.map((w) => w.id));
  const prepend: OocObjectRef[] = [];
  const append: OocObjectRef[] = [];
  const now = Date.now();

  // opts 缺省时从 thread 自身派生（thread 已带 persistence / creator*）。
  const objectId = opts.objectId ?? thread.persistence?.objectId;
  const callerThreadId = opts.callerThreadId ?? thread.creatorThreadId;
  const callerObjectId = opts.callerObjectId ?? thread.creatorObjectId;
  const isObjectThread = !!objectId && objectId !== "user";

  // 1) self 门面窗（对象自我门面）
  if (isObjectThread && !existing.has(objectId!)) {
    prepend.push(
      materializeWindow(thread, {
        id: objectId!,
        class: objectId!,
        data: {},
        parentWindowId: ROOT_WINDOW_ID,
        title: objectId!,
        status: "open",
        createdAt: now,
        closable: false,
        win: { transient: true, isSelfWindow: true },
      }),
    );
  }

  // 2) 自我视角 thread 过程窗（+ creator 通道）—— user.root 是 session 交互起点、无 creator，不注入。
  const isUserRoot = objectId === "user" && thread.id === "root";
  const threadWindowId = threadWindowIdOf(thread.id);
  if (!isUserRoot && !existing.has(threadWindowId)) {
    const hasCreator = callerThreadId !== undefined || callerObjectId !== undefined;
    // 同对象（callerObjectId === calleeObjectId）⇒ fork 子窗；跨对象 ⇒ peer 会话窗；无 creator ⇒ 空通道。
    const isFork = hasCreator && (opts.isFork ?? callerObjectId === objectId);
    const channel: Record<string, unknown> = !hasCreator
      ? {}
      : isFork
        ? { target: objectId, targetThreadId: callerThreadId, isForkWindow: true }
        : { target: callerObjectId, targetThreadId: callerThreadId };
    prepend.push(
      materializeWindow(thread, {
        id: threadWindowId,
        class: THREAD_CLASS_ID,
        data: channel,
        parentWindowId: ROOT_WINDOW_ID,
        title: opts.title ?? objectId ?? thread.id,
        status: "open",
        createdAt: now,
        // 结构窗：thread 与 creator 的恒在通道 → close 原语拒关（spec §5）。
        closable: false,
        win: { transient: true },
      }),
    );
  }

  // 3) 全局单例工具成员窗
  if (isObjectThread) {
    for (const memberType of GLOBAL_SINGLETON_TOOL_MEMBERS) {
      if (existing.has(memberType)) continue;
      append.push(
        materializeWindow(thread, {
          id: memberType,
          class: memberType,
          data: {},
          parentWindowId: ROOT_WINDOW_ID,
          title: `member: ${memberType}`,
          status: "open",
          createdAt: now,
          win: { transient: true, isMemberWindow: true },
        }),
      );
    }
  }

  thread.contextWindows = [...prepend, ...list, ...append];
}

export interface BuildThreadOpts {
  /** 本线程所属对象 id（缺省取 persistence.objectId）。 */
  objectId?: string;
  /** 创建本线程的线程 id（creator 通道）。 */
  callerThreadId?: string;
  /** 创建本线程的对象 id（creator 通道）。 */
  callerObjectId?: string;
  /** fork（同对象子窗）vs peer override；缺省按 callerObjectId === objectId 的对象级比较。 */
  isFork?: boolean;
  /** 初始任务标题。 */
  title?: string;
  /** 盘上定位；线程 id 缺省取其 threadId。 */
  persistence?: ThreadPersistenceRef;
  /** 线程 id（缺省取 persistence.threadId 或新生成）。 */
  id?: string;
  /** 初始调度状态（缺省 "running"）。 */
  status?: ThreadStatus;
  /** compress v2：标记为 framework summarizer 子线程。 */
  summarizer?: boolean;
}

/**
 * **集中的 thread 出生函数** —— 产出一条新线程的完整 `ThreadContext`（含初始 contextWindows）。
 *
 * `threadConstructor`（runtime.instantiate 入口）与各创建路径（flows root / talk-delivery 懒建 callee /
 * fork 子线程）共用本函数：统一身份/血缘字段 + 初始窗铺设。**纯函数、零 IO、不 mutate 任何父线程**——
 * parent-attach / 投初始消息 / wait 等调用方副作用归 caller。
 */
export function buildThread(opts: BuildThreadOpts): ThreadContext {
  // 新线程恒得新 id（persistence 只提供 baseDir/session/objectId——其 threadId 是 caller/parent 的，
  // 不可复用）；persistence.threadId 由下方对齐到本新 id。
  const id = opts.id ?? generateThreadId();
  const objectId = opts.objectId ?? opts.persistence?.objectId;
  const thread: ThreadContext = {
    id,
    status: opts.status ?? "running",
    events: [],
    creatorThreadId: opts.callerThreadId,
    creatorObjectId: opts.callerObjectId,
    contextWindows: [],
    persistence: opts.persistence ? { ...opts.persistence, threadId: id } : undefined,
    ...(opts.summarizer ? { isSummarizer: true } : {}),
  };
  initThreadContextWindows(thread, {
    objectId,
    callerThreadId: opts.callerThreadId,
    callerObjectId: opts.callerObjectId,
    isFork: opts.isFork,
    title: opts.title,
  });
  return thread;
}
