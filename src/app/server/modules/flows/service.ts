import {
  createFlowObject,
  createFlowSession,
  readThread,
  writeThread,
} from "@src/persistable";
import { loadUiServerMethods } from "@src/executable/server/loader";
import { collectExecutableKnowledgeEntries } from "@src/executable";
import type { ThreadContext } from "@src/thinkable/context";
import { initContextWindows } from "@src/executable/windows";
import { deliverTalkMessage } from "@src/executable/windows/talk/delivery";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type ContextWindow,
  type TalkWindow,
} from "@src/executable/windows/_shared/types";
import {
  SUPER_SESSION_ID,
  isSuperSessionId,
} from "@src/executable/windows/_shared/super-constants";
import type { createJobManager } from "../../runtime/job-manager";
import type { PauseStore } from "../../runtime/pause-store";
import { scanPausedThreads } from "../../runtime/thread-query";
import { applyResumeTransition, canResumeThread } from "../../runtime/thread-transition";
import { AppServerError } from "../../bootstrap/errors";
import { hashJson } from "../../bootstrap/hash";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** 约定值：user 是 web session 的特殊 flow object，控制面代它发消息；worker 不调度它。 */
const USER_OBJECT_ID = "user";

/**
 * 受保护的 super sessionId（spec 2026-05-18 super-flow-channel）：用户通过
 * HTTP API 创建 / seed 必须 reject；只由 talk-delivery 内部按需创建（系统路径）。
 */
function assertNotSuperSessionId(sessionId: string): void {
  if (isSuperSessionId(sessionId)) {
    throw new AppServerError(
      "INVALID_INPUT",
      `sessionId '${SUPER_SESSION_ID}' is reserved for system reflection flow; pick a different sessionId`,
    );
  }
}

function httpContext() {
  return {
    self: { dir: "" },
    thread: {
      id: "http",
      inject() {},
    },
  } as never;
}

function createInboxMessage(text: string, toThreadId: string, replyToWindowId?: string) {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    fromThreadId: "user",
    toThreadId,
    content: text,
    createdAt: Date.now(),
    source: "system" as const,
    ...(replyToWindowId ? { replyToWindowId } : {}),
  };
}

function appendInboxMessage(thread: ThreadContext, text: string, replyToWindowId?: string): ThreadContext {
  const message = createInboxMessage(text, thread.id, replyToWindowId);
  return {
    ...thread,
    inbox: [...(thread.inbox ?? []), message],
    events: [
      ...thread.events,
      {
        category: "context_change",
        kind: "inbox_message_arrived",
        msgId: message.id,
      },
    ],
  };
}

/**
 * 把已 paused / waiting 的 thread 翻回 running。
 *
 * Step 1（spec 2026-05-14）：取消 waitingType / awaitingChildren；wait 状态本身就是
 * "等 inbox 新消息"，写入新消息后把 status 翻回 running 即可。
 */
function reviveThreadForInboxMessage(thread: ThreadContext): ThreadContext {
  return {
    ...thread,
    status: "running",
    inboxSnapshotAtWait: undefined,
    waitingOn: undefined,
  };
}

/**
 * 用于 getThread 响应的 hash 输入：剔除 collectExecutableKnowledgeEntries 在每次响应里
 * 重新合成的 ephemeral 字段（id / createdAt），它们由 nextSyntheticId / Date.now 生成，
 * 对前端语义无影响，但会让 hash 永远变化、polling 永远命中"内容变了"。
 *
 * 对所有非 explicit 来源的合成 knowledge window 做剔除(protocol / activator / relation
 * / issue 都是每轮派生);explicit knowledge 与其它持久 window 的 id/createdAt 是真实状态,
 * 原样保留。
 *
 * IssueWindow 的 `lastSeenCommentId` / `lastNotifiedAt` 是 in-process 内存语义
 * (plan §4 决策 11),不参与 hash;polling 时若只是游标移动不应判定为内容变化。
 */
function stripVolatileForHash(payload: { contextWindows?: ContextWindow[] }) {
  if (!payload.contextWindows) return payload;
  return {
    ...payload,
    contextWindows: payload.contextWindows.map((window) => {
      if (window.type === "knowledge" && window.source !== undefined && window.source !== "explicit") {
        const { id: _id, createdAt: _createdAt, ...rest } = window;
        return rest;
      }
      // relation_window 也是每轮 derive 出来的非持久化 window;createdAt 即便用稳定来源
      // (见 deriveRelationWindow:取对端 talk_window.createdAt 最小值),作为 hash 输入也无意义,
      // 只有 body / peer fields 变化才该让 hash 变。
      if (window.type === "relation") {
        const { createdAt: _createdAt, ...rest } = window;
        return rest;
      }
      if (window.type === "issue") {
        const { lastSeenCommentId: _seen, lastNotifiedAt: _notif, ...rest } = window;
        return rest;
      }
      return window;
    }),
  };
}

async function readSessionTitle(sessionDir: string, fallback: string) {
  try {
    const raw = await readFile(join(sessionDir, ".session.json"), "utf8");
    const parsed = JSON.parse(raw) as { title?: unknown };
    return typeof parsed.title === "string" && parsed.title.trim() ? parsed.title : fallback;
  } catch {
    return fallback;
  }
}

export function createFlowsService(deps: {
  baseDir: string;
  /** U2: 当前 server 实例绑定的 stones-branch；UI server method 加载时拼路径用。 */
  stonesBranch?: string;
  pauseStore: PauseStore;
  jobManager: ReturnType<typeof createJobManager>;
}) {
  /**
   * Issue #6 Bad #1: session 存在性前置校验。所有 per-session 读 / 写接口
   * (getThread/listThreads/getFlowObject/pause/resume/continue) 之前调用,
   * 不存在 → 抛 NOT_FOUND。listFlows 自身不调本函数(父目录 flows/ 不存在
   * 时返回 [] 是合理的)。
   */
  async function ensureSessionExists(sessionId: string): Promise<void> {
    const sDir = join(deps.baseDir, "flows", sessionId);
    try {
      const stats = await stat(sDir);
      if (!stats.isDirectory()) {
        throw new AppServerError("NOT_FOUND", `session '${sessionId}' is not a directory`, { sessionId });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new AppServerError("NOT_FOUND", `session '${sessionId}' does not exist`, { sessionId });
      }
      throw error;
    }
  }

  /** Issue #6 Bad #1: flow object 存在性前置校验。 */
  async function ensureFlowObjectExists(sessionId: string, objectId: string): Promise<void> {
    await ensureSessionExists(sessionId);
    const oDir = join(deps.baseDir, "flows", sessionId, "objects", objectId);
    try {
      const stats = await stat(oDir);
      if (!stats.isDirectory()) {
        throw new AppServerError("NOT_FOUND", `flow object '${sessionId}/${objectId}' is not a directory`, { sessionId, objectId });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new AppServerError("NOT_FOUND", `flow object '${sessionId}/${objectId}' does not exist`, { sessionId, objectId });
      }
      throw error;
    }
  }

  return {
    async listFlows() {
      const flowsDir = join(deps.baseDir, "flows");
      try {
        const entries = await readdir(flowsDir, { withFileTypes: true });
        const items = await Promise.all(
          entries
            .filter((entry) => entry.isDirectory())
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(async (entry) => {
              const dir = join(flowsDir, entry.name);
              const info = await stat(dir);
              return {
                sessionId: entry.name,
                title: await readSessionTitle(dir, entry.name),
                dir,
                createdAt: info.birthtimeMs,
                updatedAt: info.mtimeMs,
                paused: deps.pauseStore.isSessionPaused(entry.name),
              };
            })
        );
        return { items, hash: hashJson(items) };
      } catch {
        return { items: [], hash: hashJson([]) };
      }
    },
    async createSession({ sessionId, title }: { sessionId: string; title?: string }) {
      assertNotSuperSessionId(sessionId);
      await createFlowSession(deps.baseDir, sessionId, title);
      return {
        sessionId,
        dir: `${deps.baseDir}/flows/${sessionId}`,
        created: true,
      };
    },
    /**
     * 一次性 seed 一个 session：建 session + user flow object + 让 user 对 target 发起 talk。
     *
     * collaborable § cross-object talk（spec 2026-05-15）：web 用户创建 session 的入口，
     * 等价于 user 这个 flow object 用 talk command 调起对 target 的会话。
     *
     * 流程：
     * 1. createFlowSession（已存在则跳过）
     * 2. 建/复用 user flow object 与 user.root thread；user.root 上挂一个指向 target 的 talk_window
     * 3. 调 deliverTalkMessage：在 target object 下创建 callee thread + 写消息（source=user）
     * 4. enqueue run-thread job（仅针对 callee thread；user thread 不入队 worker 也跳过）
     */
    async seedSession({
      sessionId,
      title,
      targetObjectId,
      initialMessage,
    }: {
      sessionId: string;
      title?: string;
      targetObjectId: string;
      initialMessage: string;
    }) {
      if (!targetObjectId.trim()) {
        throw new AppServerError("INVALID_INPUT", "targetObjectId is required");
      }
      assertNotSuperSessionId(sessionId);
      if (targetObjectId === USER_OBJECT_ID) {
        throw new AppServerError(
          "INVALID_INPUT",
          `targetObjectId cannot be "${USER_OBJECT_ID}"; pick the object the user wants to talk to`,
        );
      }
      if (!initialMessage.trim()) {
        throw new AppServerError("INVALID_INPUT", "initialMessage is required");
      }

      // 1) session
      await createFlowSession(deps.baseDir, sessionId, title);

      // 2) user flow object + user.root thread + 指向 target 的 talk_window
      await createFlowObject({
        baseDir: deps.baseDir,
        sessionId,
        objectId: USER_OBJECT_ID,
      });
      const userPersistence = {
        baseDir: deps.baseDir,
        sessionId,
        objectId: USER_OBJECT_ID,
        threadId: "root",
      } as const;
      let userThread: ThreadContext | undefined = await readThread(
        { baseDir: deps.baseDir, sessionId, objectId: USER_OBJECT_ID },
        "root",
      );
      if (!userThread) {
        userThread = {
          id: "root",
          status: "running",
          events: [],
          // user.root 不注入 creator window：user 是一切交互的起点，没有"创建它的人"，
          // creator do_window 在这里是无意义的。详见 init.ts 的 isUserRootThread。
          contextWindows: [],
          persistence: userPersistence,
        };
      }
      const talkWindowId = generateWindowId("talk");
      const talkWindow: TalkWindow = {
        id: talkWindowId,
        type: "talk",
        parentWindowId: ROOT_WINDOW_ID,
        title: targetObjectId,
        status: "open",
        createdAt: Date.now(),
        target: targetObjectId,
        conversationId: talkWindowId,
      };
      userThread.contextWindows = [...(userThread.contextWindows ?? []), talkWindow];

      // 3) 派送 — talk-delivery 内部会在 target 下创建 callee thread 并写双方消息
      const delivered = await deliverTalkMessage({
        caller: { thread: userThread, talkWindow },
        content: initialMessage,
        source: "user",
      });

      // 4) callee 入队
      const job = deps.jobManager.createRunThreadJob({
        sessionId,
        objectId: delivered.calleeObjectId,
        threadId: delivered.calleeThreadId,
      });

      return {
        sessionId,
        userThreadId: userThread.id,
        talkWindowId,
        targetObjectId: delivered.calleeObjectId,
        targetThreadId: delivered.calleeThreadId,
        jobId: job.jobId,
      };
    },
    async createFlowObject({
      sessionId,
      objectId,
      initialMessage,
    }: {
      sessionId: string;
      objectId: string;
      initialMessage?: string;
    }) {
      assertNotSuperSessionId(sessionId);
      await ensureSessionExists(sessionId);
      const ref = await createFlowObject({
        baseDir: deps.baseDir,
        sessionId,
        objectId,
      });
      const persistence = { ...ref, threadId: "root" } as const;
      const thread = {
        id: "root",
        status: "running",
        events: [],
        contextWindows: [],
        persistence,
      } satisfies ThreadContext;
      // 注入初始 creator do_window：root thread 的 creator 是外部 session
      initContextWindows(thread, {
        initialTaskTitle: initialMessage ? initialMessage.slice(0, 60) : `flow ${objectId}`,
      });
      await writeThread(initialMessage ? appendInboxMessage(thread, initialMessage) : thread);
      // 关键：只有 initialMessage 不为空才 enqueue job——
      // 空 events 的 thread 跑 LLM 会被 Claude 代理拒绝（messages 必须含 user role），
      // 立即 status=failed，后续 continue 也救不回来。
      let jobId: string | undefined;
      if (initialMessage) {
        const job = deps.jobManager.createRunThreadJob({
          sessionId,
          objectId,
          threadId: "root",
        });
        jobId = job.jobId;
      }
      return {
        sessionId,
        objectId,
        dir: `${deps.baseDir}/flows/${sessionId}/objects/${objectId}`,
        created: true,
        initialThreadId: "root",
        jobId,
      };
    },
    async getFlowObject({ sessionId, objectId }: { sessionId: string; objectId: string }) {
      await ensureFlowObjectExists(sessionId, objectId);
      return {
        sessionId,
        objectId,
        dir: `${deps.baseDir}/flows/${sessionId}/objects/${objectId}`,
        exists: true,
      };
    },
    /**
     * 列出 session 下所有 (objectId, threadId)；前端用作 thread 切换器数据源。
     *
     * 当前实现：扫描 flows/<sid>/objects/<obj>/threads/<tid>；不展开嵌套 child thread（child
     * 仍按 thread.json 里的 childThreadIds 嵌套，由前端按需展开）。
     */
    async listThreads({ sessionId }: { sessionId: string }) {
      await ensureSessionExists(sessionId);
      const objectsDir = join(deps.baseDir, "flows", sessionId, "objects");
      let objectEntries: { name: string; isDirectory(): boolean }[];
      try {
        objectEntries = await readdir(objectsDir, { withFileTypes: true });
      } catch {
        return { items: [] };
      }
      const items: { objectId: string; threadId: string }[] = [];
      for (const entry of objectEntries) {
        if (!entry.isDirectory()) continue;
        const threadsDir = join(objectsDir, entry.name, "threads");
        let threadEntries: { name: string; isDirectory(): boolean }[];
        try {
          threadEntries = await readdir(threadsDir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const t of threadEntries) {
          if (t.isDirectory()) items.push({ objectId: entry.name, threadId: t.name });
        }
      }
      items.sort((a, b) => (a.objectId === b.objectId ? a.threadId.localeCompare(b.threadId) : a.objectId.localeCompare(b.objectId)));
      return { items };
    },
    /**
     * 返回 thread 给前端 UI；contextWindows 中合成 protocol / activator 来源的 knowledge_window，
     * 让前端不需要单独跑合成逻辑就能看到 LLM 当前轮所见的全部 window。
     *
     * 不会改写磁盘上的 thread.json —— 合成只发生在响应体里。
     */
    async getThread({ sessionId, objectId, threadId }: { sessionId: string; objectId: string; threadId: string }) {
      await ensureFlowObjectExists(sessionId, objectId);
      const thread = await readThread({ baseDir: deps.baseDir, sessionId, objectId }, threadId);
      if (!thread) {
        throw new AppServerError(
          "NOT_FOUND",
          `thread '${threadId}' not found on object '${sessionId}/${objectId}'`,
          { sessionId, objectId, threadId },
        );
      }
      const enriched = await collectExecutableKnowledgeEntries(thread.contextWindows, thread);
      const payload = {
        ...thread,
        contextWindows: enriched.contextWindows ?? thread.contextWindows,
      };
      return { ...payload, hash: hashJson(stripVolatileForHash(payload)) };
    },
    /**
     * 控制面"用户回复"通道。
     *
     * collaborable § cross-object talk（spec 2026-05-15）：等价于 user 这个 flow object
     * 在它的 root thread 上调 talk_window.say —— 通过 talk-delivery 把消息派送到 callee。
     *
     * 入参：
     * - sessionId：当前 session
     * - text：消息正文
     * - targetWindowId：可选；user.root.contextWindows 里某个 talk_window 的 id；缺省时使用首个 talk_window
     *
     * 副作用：
     * - user.root.outbox 与 callee.inbox 双写
     * - callee 状态翻 running，入队一个 run-thread job
     * - 不再使用 inject 事件路径
     */
    async continueThread({
      sessionId,
      text,
      targetWindowId,
    }: {
      sessionId: string;
      text: string;
      targetWindowId?: string;
    }) {
      await ensureSessionExists(sessionId);
      const userThread = await readThread(
        { baseDir: deps.baseDir, sessionId, objectId: USER_OBJECT_ID },
        "root",
      );
      if (!userThread) {
        throw new AppServerError(
          "NOT_FOUND",
          `user thread not found for session '${sessionId}' (call seedSession first)`,
          { sessionId },
        );
      }
      const talkWindows = (userThread.contextWindows ?? []).filter(
        (w): w is TalkWindow => w.type === "talk" && !w.isCreatorWindow,
      );
      const target = targetWindowId
        ? talkWindows.find((w) => w.id === targetWindowId)
        : talkWindows[0];
      if (!target) {
        throw new AppServerError(
          "NOT_FOUND",
          `no talk_window on user.root for session '${sessionId}'${targetWindowId ? ` (looked for "${targetWindowId}")` : ""}`,
          { sessionId, targetWindowId },
        );
      }

      const delivered = await deliverTalkMessage({
        caller: { thread: userThread, talkWindow: target },
        content: text,
        source: "user",
      });

      const job = deps.jobManager.createRunThreadJob({
        sessionId,
        objectId: delivered.calleeObjectId,
        threadId: delivered.calleeThreadId,
      });
      return {
        sessionId,
        targetObjectId: delivered.calleeObjectId,
        targetThreadId: delivered.calleeThreadId,
        jobId: job.jobId,
      };
    },
    async pauseSession({ sessionId }: { sessionId: string }) {
      await ensureSessionExists(sessionId);
      deps.pauseStore.pauseSession(sessionId);
      return { sessionId, paused: true };
    },
    async resumeSession({ sessionId }: { sessionId: string }) {
      await ensureSessionExists(sessionId);
      deps.pauseStore.resumeSession(sessionId);
      // 扫 paused threads 并各入队一个 resume-thread job
      const paused = await scanPausedThreads(deps.baseDir, sessionId);
      const jobIds: string[] = [];
      const resumedThreadIds: string[] = [];
      for (const { objectId, threadId } of paused) {
        const ref = { baseDir: deps.baseDir, sessionId, objectId };
        const thread = await readThread(ref, threadId);
        if (!thread || !canResumeThread(thread)) {
          continue;
        }
        await writeThread(applyResumeTransition(thread));
        const job = deps.jobManager.createResumeThreadJob({
          sessionId,
          objectId,
          threadId,
        });
        jobIds.push(job.jobId);
        resumedThreadIds.push(`${objectId}/${threadId}`);
      }
      return { sessionId, paused: false, resumedThreadIds, jobIds };
    },
    async callMethod({
      sessionId,
      objectId,
      method,
      args = {},
    }: {
      sessionId: string;
      objectId: string;
      method: string;
      args?: Record<string, unknown>;
    }) {
      await ensureFlowObjectExists(sessionId, objectId);
      void sessionId;
      let methods;
      try {
        methods = await loadUiServerMethods({ baseDir: deps.baseDir, objectId, stonesBranch: deps.stonesBranch });
      } catch (error) {
        throw new AppServerError(
          "METHOD_LOAD_FAILED",
          `failed to load ui_methods for flow object ${objectId}: ${(error as Error).message}`,
          { sessionId, objectId, method }
        );
      }
      const entry = methods[method];
      if (!entry) {
        throw new AppServerError(
          "METHOD_NOT_FOUND",
          `ui method '${method}' not found on flow object '${objectId}'`,
          { sessionId, objectId, method, available: Object.keys(methods) }
        );
      }
      try {
        return { returnValue: await entry.fn(httpContext(), args) };
      } catch (error) {
        throw new AppServerError(
          "INTERNAL_ERROR",
          `ui method '${method}' threw: ${(error as Error).message}`,
          { sessionId, objectId, method }
        );
      }
    },
  };
}
