/**
 * sessions module — session 创建入口 (S5, 2026-06-29 落地)。
 *
 * 设计权威 (用户裁决 2026-06-29 11:47):
 *   "新建 session 时,给 user 创建一个名为 root 的 thread, 这个 thread 和普通的 thread
 *   一样的结构, 只是不参与 thread 调度"
 *
 * **`POST /api/sessions`** body `{ sessionId, title?, targetObjectId, initialMessage? }`:
 *   1. 创建 user inst (若不存在;objectId = "user")
 *   2. 创建 user.root thread (skip_scheduling=true) — 持 transcript 容器
 *   3. 创建 target agent thread (calleeObjectId=targetObjectId);把 initial message 写入
 *   4. 把 target thread ref push 进 user.root.contextWindows (user 与 target 的连接)
 *   5. 回填 user.data.rootThreadId
 *   6. 经 enqueueScheduler 唤醒 worker 推 target thread
 *   7. response: { sessionId, userObjectId, userRootThreadId, targetObjectId, targetThreadId, jobId? }
 */
import { Elysia, t } from "elysia";
import {
  getSessionRegistry,
} from "@ooc/core/runtime/object-registry.js";
import { THREAD_CLASS_ID } from "@ooc/core/types/constants.js";
import { hydrateSession, saveObjectData } from "@ooc/core/persistable/runtime-object-io.js";
import type {
  ThreadContext,
  ThreadMessage,
} from "@ooc/builtins/agent/children/thread/types.js";
import { enqueueScheduler } from "../../runtime/worker.js";
import { createLlmClient } from "@ooc/core/thinkable/llm/client.js";
import type { LlmClient } from "@ooc/core/thinkable/llm/types.js";
import type { WorldRuntime } from "@ooc/core/runtime/world-runtime.js";

const USER_OBJECT_ID = "user";
const USER_CLASS_ID = "_builtin/user";

export interface SessionsModuleConfig {
  baseDir: string;
  /** 注入 LlmClient (测试用 mock,生产用 createLlmClient())。 */
  llm?: LlmClient;
  /** auto-enqueue 开关 — POST /api/sessions 后是否自动调度 target thread。缺省 true。 */
  autoEnqueue?: boolean;
  /** WorldRuntime 句柄 (透传 reloadTable 给 worker)。 */
  worldRuntime?: WorldRuntime;
}

export function buildSessionsModule(config: SessionsModuleConfig) {
  const { baseDir } = config;
  const autoEnqueue = config.autoEnqueue ?? true;
  let _llm: LlmClient | undefined;
  function getLlm(): LlmClient {
    if (config.llm) return config.llm;
    if (!_llm) _llm = createLlmClient();
    return _llm;
  }

  return new Elysia({ prefix: "/api/sessions" })
    .post(
      "",
      async ({ body, set }) => {
        const { sessionId, title, targetObjectId, initialMessage } = body;
        void title; // 暂未持久化 session title(后续 issue 加 .session.json metadata)

        await hydrateSession(baseDir, sessionId);
        const reg = getSessionRegistry(sessionId);

        // 1. 创建 user inst (若不存在)
        let userInst = reg.getObject(USER_OBJECT_ID);
        if (!userInst) {
          userInst = { id: USER_OBJECT_ID, class: USER_CLASS_ID, data: {} };
          reg.setObject(userInst);
        }
        const userData = userInst.data as { name?: string; rootThreadId?: string };

        // 2. 创建 user.root thread (若不存在) — skip_scheduling=true
        let userRootThreadId = userData.rootThreadId;
        if (!userRootThreadId) {
          const threadCtor = reg.resolveConstructor(THREAD_CLASS_ID);
          if (!threadCtor) {
            set.status = 500;
            return { ok: false, error: { code: "THREAD_CLASS_MISSING", message: "thread class has no constructor" } };
          }
          const rootData = (await threadCtor.exec(
            {
              sessionId,
              worldDir: baseDir,
              dir: "",
              args: { calleeObjectId: USER_OBJECT_ID },
            },
            { calleeObjectId: USER_OBJECT_ID },
          )) as ThreadContext;
          rootData.skip_scheduling = true;
          // user.root.messages 不需要初始 message(它只是容器);清空构造时塞入的占位
          rootData.messages = [];
          rootData.contextWindows = []; // user.root 不需要工具窗(它不思考)
          reg.setObject({ id: rootData.id, class: THREAD_CLASS_ID, data: rootData });
          userRootThreadId = rootData.id;
          userData.rootThreadId = userRootThreadId;
        }
        const rootInst = reg.getObject(userRootThreadId)!;
        const rootData = rootInst.data as ThreadContext;

        // 3. 创建 target agent thread
        const threadCtor = reg.resolveConstructor(THREAD_CLASS_ID)!;
        const targetThread = (await threadCtor.exec(
          {
            sessionId,
            worldDir: baseDir,
            dir: "",
            args: { calleeObjectId: targetObjectId, message: initialMessage },
          },
          { calleeObjectId: targetObjectId, message: initialMessage },
        )) as ThreadContext;
        reg.setObject({ id: targetThread.id, class: THREAD_CLASS_ID, data: targetThread });

        // 4. 把 target thread ref push 进 user.root.contextWindows
        rootData.contextWindows.push({
          id: targetThread.id,
          class: THREAD_CLASS_ID,
          createdAt: Date.now(),
          closable: true,
        });

        // 5. 落盘 (user + user.root + target thread)
        await saveObjectData(baseDir, sessionId, userInst, reg);
        await saveObjectData(baseDir, sessionId, rootInst, reg);
        await saveObjectData(baseDir, sessionId, { id: targetThread.id, class: THREAD_CLASS_ID, data: targetThread }, reg);

        // 6. auto-enqueue (fire-and-forget;LLM env 缺失时 warn 不阻塞)
        let jobId: string | undefined;
        if (autoEnqueue) {
          try {
            const r = await enqueueScheduler(sessionId, getLlm(), baseDir, config.worldRuntime?.reloadTable);
            jobId = r.jobId; // S7 (2026-06-29): worker enqueue 返 jobId
          } catch (err) {
            console.warn(`[sessions] auto-enqueue skipped: ${(err as Error).message}`);
          }
        }

        return {
          ok: true,
          sessionId,
          userObjectId: USER_OBJECT_ID,
          userRootThreadId,
          targetObjectId,
          targetThreadId: targetThread.id,
          jobId,
        };
      },
      {
        body: t.Object({
          sessionId: t.String(),
          title: t.Optional(t.String()),
          targetObjectId: t.String(),
          initialMessage: t.Optional(t.String()),
        }),
      },
    );
}

/**
 * 在已存在 session 上加新 target thread + 把 ref push 进 user.root.contextWindows。
 * 由 flows module 复用(`POST /api/flows/:sid/talk-windows`),逻辑同 sessions module
 * 但不创建 user inst (假设已存在)。
 */
export async function addTalkWindowOnSession(args: {
  baseDir: string;
  sessionId: string;
  targetObjectId: string;
  initialMessage?: string;
}): Promise<
  | {
      ok: true;
      sessionId: string;
      talkWindowId: string;
      targetObjectId: string;
      targetThreadId: string;
      created: boolean;
    }
  | { ok: false; error: { code: string; message: string } }
> {
  await hydrateSession(args.baseDir, args.sessionId);
  const reg = getSessionRegistry(args.sessionId);
  const userInst = reg.getObject(USER_OBJECT_ID);
  if (!userInst) {
    return {
      ok: false,
      error: { code: "USER_NOT_FOUND", message: `user not seeded in session ${args.sessionId}; POST /api/sessions first` },
    };
  }
  const userData = userInst.data as { rootThreadId?: string };
  if (!userData.rootThreadId) {
    return {
      ok: false,
      error: { code: "USER_ROOT_MISSING", message: `user.rootThreadId missing` },
    };
  }
  const rootInst = reg.getObject(userData.rootThreadId);
  if (!rootInst) {
    return { ok: false, error: { code: "USER_ROOT_MISSING", message: "user.root thread instance missing" } };
  }
  const rootData = rootInst.data as ThreadContext;

  // 幂等检查: user.root 已有指向 targetObjectId 的 child thread?
  // 经 thread.calleeObjectId 匹配
  for (const ref of rootData.contextWindows) {
    const targetInst = reg.getObject(ref.id);
    if (targetInst?.class === THREAD_CLASS_ID) {
      const t = targetInst.data as ThreadContext;
      if (t.calleeObjectId === args.targetObjectId) {
        return {
          ok: true,
          sessionId: args.sessionId,
          talkWindowId: t.id,
          targetObjectId: args.targetObjectId,
          targetThreadId: t.id,
          created: false,
        };
      }
    }
  }

  // 新建 target thread
  const threadCtor = reg.resolveConstructor(THREAD_CLASS_ID)!;
  const targetThread = (await threadCtor.exec(
    {
      sessionId: args.sessionId,
      worldDir: args.baseDir,
      dir: "",
      args: { calleeObjectId: args.targetObjectId, message: args.initialMessage },
    },
    { calleeObjectId: args.targetObjectId, message: args.initialMessage },
  )) as ThreadContext;
  reg.setObject({ id: targetThread.id, class: THREAD_CLASS_ID, data: targetThread });

  rootData.contextWindows.push({
    id: targetThread.id,
    class: THREAD_CLASS_ID,
    createdAt: Date.now(),
    closable: true,
  });

  await saveObjectData(args.baseDir, args.sessionId, rootInst, reg);
  await saveObjectData(args.baseDir, args.sessionId, { id: targetThread.id, class: THREAD_CLASS_ID, data: targetThread }, reg);

  return {
    ok: true,
    sessionId: args.sessionId,
    talkWindowId: targetThread.id,
    targetObjectId: args.targetObjectId,
    targetThreadId: targetThread.id,
    created: true,
  };
}

/**
 * 经 user.root.contextWindows 中某 target thread 投递 user 消息 + 唤醒 worker。
 * 由 flows module 用(`POST /api/flows/:sid/continue`)。
 */
export async function continueOnSession(args: {
  baseDir: string;
  sessionId: string;
  text: string;
  targetWindowId?: string;
}): Promise<
  | {
      ok: true;
      sessionId: string;
      targetObjectId: string;
      targetThreadId: string;
    }
  | { ok: false; error: { code: string; message: string } }
> {
  await hydrateSession(args.baseDir, args.sessionId);
  const reg = getSessionRegistry(args.sessionId);

  const userInst = reg.getObject(USER_OBJECT_ID);
  if (!userInst) {
    return { ok: false, error: { code: "USER_NOT_FOUND", message: "user not seeded" } };
  }
  const userData = userInst.data as { rootThreadId?: string };
  if (!userData.rootThreadId) {
    return { ok: false, error: { code: "USER_ROOT_MISSING", message: "user.rootThreadId missing" } };
  }
  const rootInst = reg.getObject(userData.rootThreadId);
  if (!rootInst) {
    return { ok: false, error: { code: "USER_ROOT_MISSING", message: "user.root thread inst missing" } };
  }
  const rootData = rootInst.data as ThreadContext;

  // 解析 targetWindowId: 显式给即用; 缺省取 root.contextWindows 中最近活跃 child thread
  let targetThreadId = args.targetWindowId;
  if (!targetThreadId) {
    // 简单 fallback: 取末尾(最新加入)的 thread ref
    const lastRef = rootData.contextWindows[rootData.contextWindows.length - 1];
    if (!lastRef) {
      return { ok: false, error: { code: "NO_ACTIVE_TARGET", message: "user.root has no target thread" } };
    }
    targetThreadId = lastRef.id;
  }
  const targetInst = reg.getObject(targetThreadId);
  if (!targetInst || targetInst.class !== THREAD_CLASS_ID) {
    return { ok: false, error: { code: "TARGET_THREAD_NOT_FOUND", message: `${targetThreadId} not a thread in session ${args.sessionId}` } };
  }
  const targetThread = targetInst.data as ThreadContext;

  const msg: ThreadMessage = {
    id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    content: args.text,
    createdAt: Date.now(),
    from: "caller",
  };
  targetThread.messages.push(msg);
  if (targetThread.status === "waiting") targetThread.status = "running";

  await saveObjectData(args.baseDir, args.sessionId, targetInst, reg);

  return {
    ok: true,
    sessionId: args.sessionId,
    targetObjectId: targetThread.calleeObjectId,
    targetThreadId,
  };
}
