/**
 * talk —— 会话 class（OOC class 后端程序路由）。统一两种会话形态（2026-06-14，do_window 并入）：
 *
 * **A. peer 会话（跨对象）**：与另一个 flow object 通信（target=peer objectId / "user"）。
 *    constructor 校验 target stone 存在；`say` 走 talk-delivery 磁盘派送；transcript 按 windowId 过滤。
 * **B. fork 子线程（同对象）**：talk(target=自己 objectId) ⇒ fork 一条新子线程（旧 do）。
 *    `isForkWindow=true`，`targetThreadId`=子线程 id；`say` 走内存树寻址（同 session 同 job、不付磁盘 IO）；
 *    transcript 按 targetThreadId 过滤。
 *
 * 一处 `export const Class` 装配 construct（造会话）+ executable（say / close / share）+ readable
 * （投影 + set_transcript_window window method）。**wait 是 3 原语之一（非 method）**，经独立 tool 入口。
 *
 * talk 是所有会话 class 的基类（parentClass:null）；thread / reflect_request 经 class 链继承其会话行为。
 */

import { builtinRegistry } from "../_shared/registry.js";
import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { ConstructorContext, ObjectConstructor } from "@ooc/core/executable/contract.js";
import type { MethodCallSchema } from "@ooc/core/_shared/types/intent.js";
import { stat } from "node:fs/promises";
import type { ThreadPersistenceRef } from "../../../persistable/common.js";
import { stoneDir, resolveStoneIdentityRef } from "../../../persistable/index.js";
import { SUPER_ALIAS_TARGET } from "@ooc/core/_shared/types/constants.js";
import { creatorWindowIdOf } from "../_shared/types.js";
import { injectMemberWindowsIfObjectThread } from "../_shared/init.js";
import type { ThreadContext, ThreadMessage } from "../../../thinkable/context.js";
import type { TalkData } from "./types.js";
import { makeMessage, appendInbox } from "./fork.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";

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
 * fork 形态 —— talk(target=自己) 派生子线程，返回父侧 fork 子窗的 TalkData。
 *
 * 1) 校验 msg 非空（fork 形态用 msg 作子线程初始消息）
 * 2) 生成 childId，构造 child ThreadContext（creator 关系指向父）
 * 3) 写消息到 child.inbox + parent.outbox + child.events.inbox_message_arrived
 * 4) 父挂 child（childThreadIds + childThreads + 反向 _parentThreadRef）
 * 5) wait=true 时父进 waiting + inboxSnapshotAtWait
 *
 * deferred（agency 深层 thinkloop 语义，登记 WAVE4-WALL-broken-tests.md）：
 * - 子 thread 的 creator self-view 窗（旧 buildChildCreatorWindow）随 self-view 窗 = OocObjectInstance
 *   投影模型重设计，本轮不在 construct 内造（子 thread 起 thinkloop 时由 init 投影）。
 * - share_windows 初始随传（依赖已删的 sharing 字段）不再支持。
 */
async function execFork(ctx: ConstructorContext, selfObjectId: string): Promise<TalkData> {
  const parent = ctx.thread;
  if (!parent) throw new Error("[talk] 缺少 thread context。");

  const content = typeof ctx.args.msg === "string" ? ctx.args.msg : "";
  if (!content.trim()) {
    throw new Error("[talk] fork（target=自己）形态缺少 msg 参数（给子线程的初始消息）。");
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
    conversationId: "",
  };
}

/**
 * construct —— 创建 talk_window。target=自己 objectId ⇒ fork 子线程；否则 peer 会话。
 *
 * 返回新实例的 TalkData（runtime 据此包成 OocObjectInstance 信封）。conversationId 缺省由
 * runtime 分配的实例 id 充当——construct 不知实例 id，故置空，readable/say 用 ctx.object.id。
 */
const talkConstructor: ObjectConstructor<TalkData> = {
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
  exec: async (ctx: ConstructorContext, args: Record<string, unknown>): Promise<TalkData> => {
    const thread = ctx.thread;
    if (!thread) throw new Error("[talk] 缺少 thread context。");
    const target = typeof args.target === "string" ? args.target.trim() : "";
    if (!target) throw new Error(`[talk] 缺少 target 参数。\n${TALK_CONSTRUCTOR_TIP}`);

    const selfObjectId = thread.persistence?.objectId;
    // fork 形态：target=自己 objectId ⇒ 派生同对象子线程（旧 do）。
    if (selfObjectId && target === selfObjectId) {
      return execFork(ctx, selfObjectId);
    }

    // peer 形态：跨对象会话。
    const title = typeof args.title === "string" ? deriveTalkTitle(args.title) : "";
    if (!title) throw new Error("[talk] peer 会话缺少 title 参数。");

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
          `[talk] target \`${target}\` 不存在(本 session worktree 与 main canonical 均未找到该对象目录)。请检查 target 拼写是否正确;若是新对象,先 create_object 再 open talk_window。`,
        );
      }
    }

    return {
      target,
      conversationId: "",
    };
  },
};

export const Class: OocClass<TalkData> = {
  construct: talkConstructor,
  executable,
  readable,
};

// talk 是所有会话 class 的基类（parentClass:null，不继承 root）；isBuiltinFeature=固有特性，
// 状态 inline 进所属 thread 的 context.json，不写独立 stone dir。
// thread / reflect_request 经 class 链继承其会话行为（见 windows/index.ts 注册）。
builtinRegistry.register("talk", Class, { parentClass: null, isBuiltinFeature: true });

// creatorWindowIdOf 仍由 delivery / init 等会话路径使用——re-export 保持单一来源。
export { creatorWindowIdOf };
export type { TalkData, TalkWin } from "./types.js";
