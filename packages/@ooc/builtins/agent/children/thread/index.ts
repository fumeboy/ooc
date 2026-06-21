/**
 * thread —— ooc class：agent 一次智能运行的载体，也是**唯一**会话载体注册 class。
 *
 * 所有会话窗（creator/peer/sub/fork）都是 thread 实例（inst.class=`_builtin/agent/thread`）；talk /
 * reflect_request 不再是注册 class，而是 thread readable 按视角投影出的 window class
 * （context.md 核心 2/8/9）。
 *
 * 一处 `export const Class` 装配四维度：
 * - construct（**本文件内实现**）：造会话窗（peer / fork 两形态）；agent.talk 经
 *   runtime.instantiate("_builtin/agent/thread") 委托。统一两种会话形态：
 *     A. peer 会话（跨对象）：target=别的 objectId / "user"；construct 校验 target stone 存在；
 *        say 走 talk-delivery 磁盘派送。
 *     B. fork 子线程（同对象，旧 do）：target=自己 objectId ⇒ 派生子线程；isForkWindow=true，
 *        targetThreadId=子线程 id；say 走内存树寻址。
 * - executable：会话 say/close/share + reflectable 沉淀 new_feat_branch/create_pr_and_invite_reviewers。
 * - readable：3 个 window decl（thread/talk/reflect_request 投影）+ 内部 computeProjectionClass 算投影 class。
 * - persistable：声明 `mode:"inline"`（运行态自有窗，整窗随 thread-context inline 落盘）。
 *
 * thread 继承 root 缺省（package.json 无 `ooc.class`）。**wait 是 3 原语之一（非 method）**，独立 tool 入口。
 */
import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type {
  ConstructorContext,
  ObjectConstructor,
  ObjectLifecycleHook,
} from "@ooc/core/executable/contract.js";
import type { MethodCallSchema } from "@ooc/core/_shared/types/intent.js";
import { stat } from "node:fs/promises";
import type { ThreadPersistenceRef } from "@ooc/core/persistable/common.js";
import { stoneDir, resolveStoneIdentityRef } from "@ooc/core/persistable/index.js";
import { SUPER_ALIAS_TARGET } from "@ooc/core/_shared/types/constants.js";
import { injectMemberWindowsIfObjectThread } from "@ooc/core/thinkable/context/init.js";
import type { ThreadContext, ThreadMessage } from "@ooc/core/thinkable/context.js";
import {
  makeMessage,
  appendInbox,
  findChild,
} from "@ooc/builtins/agent/thread/executable/talk-fork.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import persistable from "./persistable/index.js";
import { writeThread } from "./persistable/thread-json.js";
import type { Data } from "./types.js";

const TALK_CONSTRUCTOR_TIP = `talk 开启一个持续会话 talk_window。
- target=别的 objectId（"user" 也是）⇒ peer 跨对象会话。
- target=自己的 objectId ⇒ fork 一条同对象子线程（旧 do）。
参数：target（必填）、title（peer 形态）、msg（fork 形态初始消息）。`;

function deriveTalkTitle(raw: string, max = 60): string {
  const trimmed = raw.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`;
}

function generateThreadId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function deriveChildPersistence(
  parent: ThreadContext,
  childId: string,
): ThreadPersistenceRef | undefined {
  if (!parent.persistence) return undefined;
  return { ...parent.persistence, threadId: childId };
}

/**
 * fork 形态 —— talk(target=自己) 派生子线程，返回父侧 fork 子窗的 Data。
 * 写消息到 child.inbox + parent.outbox；父挂 child（childThreadIds/childThreads/_parentThreadRef）；
 * wait=true 时父进 waiting。
 *
 * deferred（agency 深层 thinkloop 语义，登记 WAVE4-WALL-broken-tests.md）：子 thread 的 creator
 * self-view 窗本轮不在 construct 内造（子 thread 起 thinkloop 时由 init 投影）；share_windows 不再支持。
 */
async function execFork(ctx: ConstructorContext, selfObjectId: string): Promise<Data> {
  const parent = ctx.thread;
  if (!parent) throw new Error("[thread] 缺少 thread context。");

  const content = typeof ctx.args.msg === "string" ? ctx.args.msg : "";
  if (!content.trim()) {
    throw new Error("[thread] fork（target=自己）形态缺少 msg 参数（给子线程的初始消息）。");
  }
  const wait = ctx.args.wait === true;

  const childId = generateThreadId();
  const child: ThreadContext = {
    id: childId,
    status: "running",
    events: [],
    parentThreadId: parent.id,
    creatorThreadId: parent.id,
    creatorObjectId: selfObjectId,
    contextWindows: [],
    persistence: deriveChildPersistence(parent, childId),
    // compress v2：framework summarizer fork 标记（spawnSummarizerFork 传 args.summarizer=true）。
    ...(ctx.args.summarizer === true ? { isSummarizer: true } : {}),
  };

  // fork 子线程是同 object 的 sub-thread——继承该 object 声明持有的 tool-object 成员（如 filesystem）。
  await injectMemberWindowsIfObjectThread(child);

  const message: ThreadMessage = makeMessage(parent.id, childId, content);
  appendInbox(child, message);
  parent.outbox = [...(parent.outbox ?? []), message];

  parent.childThreadIds = [...(parent.childThreadIds ?? []), childId];
  parent.childThreads = { ...(parent.childThreads ?? {}), [childId]: child };
  Object.defineProperty(child, "_parentThreadRef", {
    value: parent,
    enumerable: false,
    writable: true,
    configurable: true,
  });

  if (wait) {
    parent.status = "waiting";
    parent.inboxSnapshotAtWait = parent.inbox?.length ?? 0;
  }

  return {
    target: selfObjectId,
    targetThreadId: childId,
    isForkWindow: true,
  };
}

/**
 * construct —— 创建 talk_window。target=自己 objectId ⇒ fork 子线程；否则 peer 会话。
 * 返回新实例的 Data（runtime 据此包成 OocObjectInstance 实例）。会话身份（conversationId）恒等于
 * runtime 分配的实例 id——不入 Data，readable/say 一律用 ctx.object.id。
 */
const talkConstructor: ObjectConstructor<Data> = {
  description:
    "Open a talk_window: target=another object ⇒ peer conversation; target=self ⇒ fork a child thread.",
  schema: {
    args: {
      target: { type: "string", required: true, description: '目标 objectId（别的对象 / "user" ⇒ peer 会话；自己的 objectId ⇒ fork 子线程）' },
      title: { type: "string", required: false, description: "peer 会话主题（peer 形态必填）" },
      msg: { type: "string", required: false, description: "fork 子线程初始消息（fork 形态必填）" },
      wait: { type: "boolean", required: false, default: false, description: "（fork）true 时父线程立刻进入 waiting，等子线程回写" },
    },
  } as MethodCallSchema,
  exec: async (ctx: ConstructorContext, args: Record<string, unknown>): Promise<Data> => {
    const thread = ctx.thread;
    if (!thread) throw new Error("[thread] 缺少 thread context。");
    const target = typeof args.target === "string" ? args.target.trim() : "";
    if (!target) throw new Error(`[thread] 缺少 target 参数。\n${TALK_CONSTRUCTOR_TIP}`);

    const selfObjectId = thread.persistence?.objectId;
    // fork 形态：target=自己 objectId ⇒ 派生同对象子线程（旧 do）。
    if (selfObjectId && target === selfObjectId) {
      return execFork(ctx, selfObjectId);
    }

    // peer 形态：跨对象会话。
    const title = typeof args.title === "string" ? deriveTalkTitle(args.title) : "";
    if (!title) throw new Error("[thread] peer 会话缺少 title 参数。");

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
        throw new Error(
          `[thread] target \`${target}\` 不存在(本 session worktree 与 main canonical 均未找到该对象目录)。请检查 target 拼写是否正确;若是新对象,先 create_object 再 open talk_window。`,
        );
      }
    }

    return {
      target,
    };
  },
};

// ─────────────────────────── unactive（生命周期：refcount 归 0 触发）───────────────────────────

/** 退出态（不计入 refcount）。non-terminal 线程失去最后订阅者时由 unactive 通知、不强制终结。 */
const TERMINAL = new Set(["done", "failed"]);

/**
 * thread.unactive —— 被解引用的线程 refcount 归 0（最后一个订阅它的 context window 被 close）时，
 * 由 close 原语经 dispatchUnactiveIfZero 单次派发。
 *
 * 通知语义（取代旧 cancelSubtree 强杀 + 级联）：thread 是持久身份、OOC 无强制 destruct——
 * - non-terminal（running/paused/waiting）：往该 thread 自己 inbox 发一条 system 通知
 *   「creator 已关闭对话窗口，当前已无消息订阅者」，由 thread 下一轮 thinkloop 自决（通常优雅 end）；
 *   waiting 线程因 inbox 增长被 scheduler.wakeWaitingThreadsOnInbox 自然唤醒。**不切终态、不级联**。
 * - terminal（done/failed）：已退出，仅停用、无需通知。
 * 返回 void（不 delete）：thread 身份留存。
 */
const unactive: ObjectLifecycleHook = {
  description:
    "Notify the dereferenced thread it lost its last subscriber (creator closed the conversation window); non-terminal threads receive an inbox notice and self-decide whether to end. No cancel / cascade / forced destruct.",
  exec: async (ctx) => {
    if (!ctx.thread) return;
    const t = findChild(ctx.thread, ctx.targetId);
    if (!t || TERMINAL.has(t.status)) return;
    const notice: ThreadMessage = {
      ...makeMessage(
        t.id,
        t.id,
        "[系统] creator 已关闭对话窗口，当前 thread 已无消息订阅者；可自行决定是否 end。",
      ),
      source: "system",
    };
    appendInbox(t, notice); // 写自身 inbox + push inbox_message_arrived 事件（waiting 由此唤醒）
    if (t.persistence) await writeThread(t);
  },
};

export const Class: OocClass<Data> = {
  construct: talkConstructor,
  executable,
  readable,
  persistable,
  unactive,
};

export type { Data } from "./types.js";
