/**
 * thread —— ooc class：agent 一次智能运行的载体，也是**唯一**会话载体注册 class。
 *
 * 所有会话窗（creator/peer/sub/fork）都是 thread 实例（inst.class=`_builtin/agent/thread`）；talk /
 * reflect_request 不再是注册 class，而是 thread readable 按视角投影出的 window class
 * （context.md 核心 2/8/9）。
 *
 * 一处 `export const Class` 装配各维度：
 * - construct（**本文件 `threadConstructor`**）：**纯工厂**——给定 `callerThreadId / callerObjectId /
 *   calleeObjectId` 三个显式身份，产出一条**新线程**的完整 `ThreadContext`（含初始 contextWindows）。
 *   不掏 `runningThread(ctx)`、不 mutate 任何父线程：parent-attach / 投初始消息 / wait 等**调用方副作用**
 *   归 caller（agent.talk / compress summarizer-fork / talk-delivery 懒建 callee）。
 * - executable：会话 say/close/share + reflectable 沉淀 new_feat_branch/create_pr_and_invite_reviewers。
 * - readable：3 个 window decl（thread/talk/reflect_request 投影）+ 内部 computeProjectionClass 算投影 class。
 * - persistable：声明 `mode:"inline"`（运行态自有窗，整窗随 thread-context inline 落盘）。
 * - unactive：被解引用线程 refcount 归 0 时通知它（**接收 self = 目标线程**，不掏 runningThread）。
 *
 * thread 继承 root 缺省（package.json 无 `ooc.class`）。**wait 是 3 原语之一（非 method）**，独立 tool 入口。
 */
import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type {
  ConstructorContext,
  ObjectConstructor,
  LifecycleContext,
  ObjectLifecycleHook,
} from "@ooc/core/executable/contract.js";
import type { MethodCallSchema } from "@ooc/core/_shared/types/intent.js";
import type { ThreadContext, ThreadMessage } from "@ooc/builtins/agent/thread/types.js";
import { makeMessage, appendInbox } from "./executable/talk-fork.js";
import { buildThread } from "./thinkable/context/init-windows.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import thinkable from "./thinkable/index.js";
import persistable from "./persistable/index.js";
import { writeThread } from "./persistable/thread-json.js";
import type { Data } from "./types.js";

/**
 * construct —— **纯工厂**：产出一条新线程的完整 `ThreadContext`（含初始 contextWindows）。
 *
 * 不掏 `runningThread(ctx)`、不 mutate 父线程。parent-attach / 投初始消息 / wait 归调用方。
 * 盘上定位取 `ctx.persistence`（runtime 分配），线程 id 取 `ctx.persistence.threadId` 或新生成。
 */
const threadConstructor: ObjectConstructor<Data> = {
  description:
    "Construct a new thread (conversation carrier). callerObjectId===calleeObjectId ⇒ fork child; else peer callee.",
  schema: {
    args: {
      calleeObjectId: { type: "string", required: false, description: "本线程所属对象 id（缺省取 ctx.persistence.objectId）" },
      callerThreadId: { type: "string", required: false, description: "创建本线程的线程 id（creator 通道）" },
      callerObjectId: { type: "string", required: false, description: "创建本线程的对象 id（creator 通道）" },
      title: { type: "string", required: false, description: "初始任务标题" },
    },
  } as MethodCallSchema,
  exec: async (ctx: ConstructorContext, args: Record<string, unknown>): Promise<Data> => {
    return buildThread({
      objectId:
        (typeof args.calleeObjectId === "string" && args.calleeObjectId) || ctx.persistence?.objectId,
      callerThreadId: typeof args.callerThreadId === "string" ? args.callerThreadId : undefined,
      callerObjectId: typeof args.callerObjectId === "string" ? args.callerObjectId : undefined,
      title: typeof args.title === "string" ? args.title : undefined,
      persistence: ctx.persistence,
    });
  },
};

// ─────────────────────────── unactive（生命周期：refcount 归 0 触发）───────────────────────────

/** 退出态（不计入 refcount）。non-terminal 线程失去最后订阅者时由 unactive 通知、不强制终结。 */
const TERMINAL = new Set(["done", "failed"]);

/**
 * thread.unactive —— 被解引用的线程 refcount 归 0（最后一个订阅它的 context window 被 close）时，
 * 由 close 原语经 dispatchUnactiveIfZero 单次派发。**接收 `self` = 被解引用的目标线程本身**
 * （不掏 runningThread / findChild）。
 *
 * 通知语义（取代旧 cancelSubtree 强杀 + 级联）：thread 是持久身份、OOC 无强制 destruct——
 * - non-terminal（running/paused/waiting）：往该 thread 自己 inbox 发一条 system 通知，由其下一轮
 *   thinkloop 自决（通常优雅 end）；waiting 线程因 inbox 增长被 scheduler 自然唤醒。**不切终态、不级联**。
 * - terminal（done/failed）：已退出，仅停用、无需通知。
 * 返回 void（不 delete）：thread 身份留存。
 */
const unactive: ObjectLifecycleHook = {
  description:
    "Notify the dereferenced thread (received as self) it lost its last subscriber; non-terminal threads receive an inbox notice and self-decide whether to end. No cancel / cascade / forced destruct.",
  exec: async (_ctx: LifecycleContext, self: unknown) => {
    const t = self as ThreadContext | undefined;
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
  construct: threadConstructor,
  executable,
  readable,
  thinkable,
  persistable,
  unactive,
};

export { threadConstructor };
export type { Data } from "./types.js";
