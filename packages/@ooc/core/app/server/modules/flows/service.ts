import {
  createFlowObject,
  createFlowSession,
  ensureSessionWorktree,
  objectDir,
  readThread,
  threadDir,
  writeThread,
  STONE_CHILDREN_SUBDIR,
} from "@ooc/core/persistable";
import { loadObjectWindow } from "@ooc/core/runtime/server-loader";
import { normalizeMethodOutcome } from "@ooc/core/_shared/types/method.js";
import { enrichContextWindows } from "@ooc/core/thinkable/context/window-enrichment";
import type { ThreadContext } from "@ooc/core/thinkable/context";
import { initContextWindows, injectPeerWindowsIfObjectThread } from "@ooc/core/executable/windows";
import { deliverTalkMessage } from "@ooc/core/executable/windows/talk/delivery";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type ContextWindow,
  type TalkWindow,
} from "@ooc/core/executable/windows/_shared/types";
import {
  SUPER_SESSION_ID,
  isSuperSessionId,
} from "@ooc/core/_shared/types/constants.js";
import type {
  ListThreadsItem,
  ListThreadsResponse,
  ThreadShareInfo,
} from "./model";
import type { createJobManager } from "../../runtime/job-manager";
import type { PauseStore } from "../../runtime/pause-store";
import { resumePausedThreadsInSession } from "../../runtime/resume-orchestration";
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
 * 对所有非 explicit 来源的合成 knowledge window 做剔除(protocol / activator
 * 都是每轮派生);explicit knowledge 与其它持久 window 的 id/createdAt 是真实状态,
 * 原样保留。
 *
 * 同样要剔除每轮 derive 的 skill_index：id 稳定（SKILL_INDEX_WINDOW_ID）但
 * createdAt=Date.now() 每次都新，否则 hash 永远翻动。skills 数组本身是稳定排序的
 * 内容字段，参与 hash。
 *
 * 历史：2026-05-26 移除 IssueWindow strip 分支（issue 看板已整体下线）。
 */
function stripVolatileForHash(payload: { contextWindows?: ContextWindow[] }) {
  if (!payload.contextWindows) return payload;
  return {
    ...payload,
    contextWindows: payload.contextWindows.map((window) => {
      if (window.class === "knowledge" && window.source !== undefined && window.source !== "explicit") {
        const { id: _id, createdAt: _createdAt, ...rest } = window;
        return rest;
      }
      // skill_index 也是每轮 derive 出来的非持久化 window;createdAt=Date.now() 每次都新。
      if (window.class === "skill_index") {
        const { createdAt: _createdAt, ...rest } = window;
        return rest;
      }
      return window;
    }),
  };
}

/**
 * 从一个 ThreadContext 抽取 shares 摘要（holding + lentOut）。
 *
 * 输入是已 readThread 出来的 ThreadContext.contextWindows；遍历每个 window 的
 * sharing 字段：
 * - sharing.kind === "ref" → 进 holding（我持有别人借给我的 ref；ownerThreadId 来自 sharing）
 * - sharing.kind === "lent_out" → 进 lentOut（我借出去；borrowerThreadId 来自 sharing）
 *
 * 注意：当前 SharingState（src/executable/windows/_shared/types.ts）**不持久化**
 * ownerObjectId / borrowerObjectId 字段 —— 它们是 design 预留位（design:
 * docs/2026-05-26-session-threads-index-design.md §4.1），实现里永远 undefined。
 * 未来若 sharing 扩展，这里读出来即可。
 *
 * 退化：sharing 字段不存在 / shape 异常 → 跳过该 entry，不抛错。
 */
function extractShareInfo(windows: ContextWindow[] | undefined): ThreadShareInfo {
  const holding: ThreadShareInfo["holding"] = [];
  const lentOut: ThreadShareInfo["lentOut"] = [];
  for (const window of windows ?? []) {
    const sharing = (window as { sharing?: unknown }).sharing;
    if (!sharing || typeof sharing !== "object") continue;
    const s = sharing as Record<string, unknown>;
    if (s.kind === "ref") {
      holding.push({
        windowId: window.id,
        kind: "ref",
        ownerThreadId:
          typeof s.ownerThreadId === "string" ? s.ownerThreadId : undefined,
        // ownerObjectId 暂未持久化在 SharingState；design 预留位。
        ownerObjectId: undefined,
      });
    } else if (s.kind === "lent_out") {
      lentOut.push({
        windowId: window.id,
        borrowerThreadId:
          typeof s.borrowerThreadId === "string" ? s.borrowerThreadId : undefined,
        // borrowerObjectId 暂未持久化在 SharingState；design 预留位。
        borrowerObjectId: undefined,
      });
    }
    // 其它未知 kind / shape 异常 → 静默跳过（design 要求"不抛错"）
  }
  return { holding, lentOut };
}

/**
 * 从 ThreadContext 抽取 talkPeers 摘要。
 *
 * 来源：contextWindows[type==="talk"]；每个 TalkWindow 对应一个 talkPeer。
 * - targetObjectId ← talk.target
 * - targetThreadId ← talk.targetThreadId（首条 say 之前可能 undefined）
 * - windowId      ← talk_window.id 自身
 */
function extractTalkPeers(
  windows: ContextWindow[] | undefined,
): ListThreadsItem["talkPeers"] {
  const peers: ListThreadsItem["talkPeers"] = [];
  for (const window of windows ?? []) {
    if (window.class !== "talk") continue;
    peers.push({
      targetObjectId: window.target,
      targetThreadId: window.targetThreadId,
      windowId: window.id,
    });
  }
  return peers;
}

/**
 * 构造单个 ListThreadsItem。
 *
 * 读 thread.json + thread 目录 stat（拿 createdAt）；任一步失败 → 退化为
 * status="failed"，其它字段 undefined / 空数组，**不抛错**。
 */
async function buildListThreadsItem(args: {
  baseDir: string;
  sessionId: string;
  objectId: string;
  threadId: string;
  isSuperFlow: boolean | undefined;
}): Promise<ListThreadsItem> {
  const { baseDir, sessionId, objectId, threadId, isSuperFlow } = args;
  const base: ListThreadsItem = {
    objectId,
    threadId,
    status: "failed",
    childThreadIds: [],
    talkPeers: [],
    shares: { holding: [], lentOut: [] },
    ...(isSuperFlow ? { isSuperFlow: true } : {}),
  };
  // 读 thread.json：损坏 / ENOENT → 退化（保持 base 的 status="failed"）
  let thread;
  try {
    thread = await readThread({ baseDir, sessionId, objectId }, threadId);
  } catch {
    return base;
  }
  if (!thread) return base;

  // createdAt 不在 ThreadContext 里；用 thread 目录的 birthtime 兜底
  let createdAt: number | undefined;
  try {
    const tDir = threadDir({ baseDir, sessionId, objectId, threadId });
    const info = await stat(tDir);
    createdAt = info.birthtimeMs;
  } catch {
    createdAt = undefined;
  }

  return {
    objectId,
    threadId,
    status: thread.status,
    createdAt,
    parentThreadId: thread.parentThreadId,
    creatorThreadId: thread.creatorThreadId,
    creatorObjectId: thread.creatorObjectId,
    childThreadIds: thread.childThreadIds ?? [],
    talkPeers: extractTalkPeers(thread.contextWindows as ContextWindow[]),
    shares: extractShareInfo(thread.contextWindows as ContextWindow[]),
    ...(isSuperFlow ? { isSuperFlow: true } : {}),
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
    const oDir = objectDir({ baseDir: deps.baseDir, sessionId, objectId });
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

  /**
   * business session 创建入口：eager 建 session worktree（`flows/<sid>` = 从 main 派生的
   * git worktree，方案 A 2026-06-09）。**必须在写任何运行时数据（.session.json / threads/）
   * 前调用**——`git worktree add` 要求目标空目录。失败 → fail-loud（决策 4），不静默回退。
   */
  async function eagerEnsureSessionWorktree(sessionId: string): Promise<void> {
    const ok = await ensureSessionWorktree(deps.baseDir, sessionId);
    if (!ok) {
      throw new AppServerError(
        "INTERNAL_ERROR",
        `failed to create session worktree for '${sessionId}' (git worktree add flows/${sessionId} failed); session not created`,
        { sessionId },
      );
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
      // 先 eager 建 worktree（空目录要求）再写 .session.json（运行时数据）。
      await eagerEnsureSessionWorktree(sessionId);
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
     * 等价于 user 这个 flow object 用 talk method 调起对 target 的会话。
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
      // class 不可交互（只供 object 继承）——`_builtin/<id>` 是 class 寻址，拒绝作为对话目标。
      if (targetObjectId.startsWith("_builtin/")) {
        throw new AppServerError(
          "INVALID_INPUT",
          `targetObjectId "${targetObjectId}" is a class, not an interactive object; talk to its instance instead`,
        );
      }
      if (!initialMessage.trim()) {
        throw new AppServerError("INVALID_INPUT", "initialMessage is required");
      }

      // 1) session —— 先 eager 建 worktree（空目录要求）再写运行时数据
      await eagerEnsureSessionWorktree(sessionId);
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
        class: "talk",
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
    /**
     * 在已存在 session 的 user.root 上追加一个新的 talk_window 指向 targetObjectId。
     *
     * 与 seedSession 的差别：
     * - 不再 createFlowSession / 不再建 user flow object（要求 user.root 已存在；
     *   不存在抛 NOT_FOUND，提示先 seedSession）
     * - 同 target 已有非 creator talk_window 时**幂等**复用既有那一条，不重复创建窗口
     * - initialMessage 可选：缺省时只挂 talk_window 不派送、不入 callee job；提供时
     *   走 deliverTalkMessage（与 seedSession 一致），创建 callee thread + 双写消息 + 入队
     * - 根因 #5（2026-05-27）：幂等命中既有窗口时**仍要投递 initialMessage**——
     *   带消息无论窗口新建/复用都必须送达 + 触发 thinkloop，不得静默丢；返回里
     *   created 区分新建(true)/复用(false)，jobId 表示消息确实入队
     */
    async addUserTalkWindow({
      sessionId,
      targetObjectId,
      initialMessage,
    }: {
      sessionId: string;
      targetObjectId: string;
      initialMessage?: string;
    }) {
      assertNotSuperSessionId(sessionId);
      await ensureSessionExists(sessionId);
      const target = targetObjectId.trim();
      if (!target) {
        throw new AppServerError("INVALID_INPUT", "targetObjectId is required");
      }
      if (target === USER_OBJECT_ID) {
        throw new AppServerError(
          "INVALID_INPUT",
          `targetObjectId cannot be "${USER_OBJECT_ID}"; pick the object the user wants to talk to`,
        );
      }

      const userPersistence = {
        baseDir: deps.baseDir,
        sessionId,
        objectId: USER_OBJECT_ID,
        threadId: "root",
      } as const;
      const userThread = await readThread(
        { baseDir: deps.baseDir, sessionId, objectId: USER_OBJECT_ID },
        "root",
      );
      if (!userThread) {
        throw new AppServerError(
          "NOT_FOUND",
          `user.root thread not found for session '${sessionId}'; call seedSession first`,
          { sessionId },
        );
      }
      // 保险：旧版 thread.json 可能没写 persistence 字段；deliverTalkMessage 强制要求它
      if (!userThread.persistence) userThread.persistence = userPersistence;

      // 幂等：已经有指向同 target 的非 creator talk_window 时复用它。
      const existing = ((userThread.contextWindows ?? []) as ContextWindow[]).find(
        (w): w is TalkWindow => w.class === "talk" && !w.isCreatorWindow && w.target === target,
      );
      if (existing) {
        // 无 initialMessage：纯幂等创建窗口语义，无消息要送，早返回。
        if (!initialMessage || !initialMessage.trim()) {
          return {
            sessionId,
            talkWindowId: existing.id,
            targetObjectId: target,
            targetThreadId: existing.targetThreadId,
            jobId: undefined as string | undefined,
            created: false,
          };
        }
        // 根因 #5：带了 initialMessage 时不得静默丢弃。复用既有 talk_window，
        // 但仍走 deliverTalkMessage 投递 + run-thread 入队（与 continueThread / 新建分支一致），
        // 返回真 jobId；created:false 表示复用了既有窗口。
        const delivered = await deliverTalkMessage({
          caller: { thread: userThread, talkWindow: existing },
          content: initialMessage,
          source: "user",
        });
        const job = deps.jobManager.createRunThreadJob({
          sessionId,
          objectId: delivered.calleeObjectId,
          threadId: delivered.calleeThreadId,
        });
        return {
          sessionId,
          talkWindowId: existing.id,
          targetObjectId: delivered.calleeObjectId,
          targetThreadId: delivered.calleeThreadId,
          jobId: job.jobId,
          created: false,
        };
      }

      const talkWindowId = generateWindowId("talk");
      const talkWindow: TalkWindow = {
        id: talkWindowId,
        class: "talk",
        parentWindowId: ROOT_WINDOW_ID,
        title: target,
        status: "open",
        createdAt: Date.now(),
        target,
        conversationId: talkWindowId,
      };
      userThread.contextWindows = [...(userThread.contextWindows ?? []), talkWindow];

      // initialMessage 缺省：仅持久化 talk_window；提供时走 deliverTalkMessage（同 seedSession）
      if (!initialMessage || !initialMessage.trim()) {
        await writeThread(userThread);
        return {
          sessionId,
          talkWindowId,
          targetObjectId: target,
          targetThreadId: undefined as string | undefined,
          jobId: undefined as string | undefined,
          created: true,
        };
      }

      const delivered = await deliverTalkMessage({
        caller: { thread: userThread, talkWindow },
        content: initialMessage,
        source: "user",
      });
      const job = deps.jobManager.createRunThreadJob({
        sessionId,
        objectId: delivered.calleeObjectId,
        threadId: delivered.calleeThreadId,
      });
      return {
        sessionId,
        talkWindowId,
        targetObjectId: delivered.calleeObjectId,
        targetThreadId: delivered.calleeThreadId,
        jobId: job.jobId,
        created: true,
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
      await injectPeerWindowsIfObjectThread(thread);
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
        dir: objectDir({ baseDir: deps.baseDir, sessionId, objectId }),
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
        dir: objectDir({ baseDir: deps.baseDir, sessionId, objectId }),
        exists: true,
      };
    },
    /**
     * 列出 session 下所有 (objectId, threadId) + thread metadata + 4 种关系字段。
     *
     * Round 8 D2 扩展（design: docs/2026-05-26-session-threads-index-design.md §4.1）：
     * 在原 `{ objectId, threadId }` 基础上增加 status / createdAt / parent / creator /
     * childThreadIds / talkPeers / shares / isSuperFlow，让前端 SessionThreadsIndex
     * 能据此画分栏 + 关系，不再需要拉每个 thread 详情。
     *
     * 实现：
     * 1. 扫描 flows/<sid>/objects/<obj>/threads/<tid>，得到所有二元组
     * 2. 对每个 (objectId, threadId) 调 readThread 拿 ThreadContext，提取字段
     * 3. 退化：readThread 失败 / 损坏 → status="failed"，其它字段 undefined，**不抛错**
     * 4. talkPeers 来源：contextWindows[type==="talk"]
     * 5. shares 来源：contextWindows[*].sharing（kind=ref 进 holding，kind=lent_out 进 lentOut）
     * 6. isSuperFlow：sessionId === SUPER_SESSION_ID
     *
     * 性能：一个 session 内 threads 数预估 < 50；50 次 fs.read 串行 OK。
     */
    async listThreads({ sessionId }: { sessionId: string }): Promise<ListThreadsResponse> {
      await ensureSessionExists(sessionId);
      // 方案 A 续（2026-06-09）：flow object 落 `flows/<sid>/objects/<nestedObjectPath>`
      //（objectDir = flows/<sid>/objects/<id>），与 stone identity 同落点。扫描起点是
      // `flows/<sid>/objects/` 的直接子目录（找 .flow.json 判 flow object，递归仍下 children/）。
      const sessionRoot = join(deps.baseDir, "flows", sessionId, "objects");
      const isSuperFlow = isSuperSessionId(sessionId) || undefined;
      const items: ListThreadsItem[] = [];

      // 递归扫嵌套子 object（与 thread-query.scanThreadsByStatus 同款 children/ marker
      // 协议）。一个目录是 flow object iff 直接含 .flow.json；递归只下到 children/ 子目录。
      // objectId 由相对 session 根的路径剥掉所有 children/ 段后用 "/" 拼。
      async function walkObjectDir(dir: string, idSegments: string[]): Promise<void> {
        let entries: import("node:fs").Dirent[];
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT" || code === "EACCES" || code === "ENOTDIR") return;
          throw error;
        }
        const isFlowObject = entries.some((e) => e.isFile() && e.name === ".flow.json");
        const objectId = idSegments.join("/");
        if (isFlowObject && objectId) {
          const threadsDir = join(dir, "threads");
          let threadEntries: import("node:fs").Dirent[] = [];
          try {
            threadEntries = await readdir(threadsDir, { withFileTypes: true });
          } catch {
            threadEntries = [];
          }
          for (const t of threadEntries) {
            if (!t.isDirectory()) continue;
            items.push(
              await buildListThreadsItem({
                baseDir: deps.baseDir,
                sessionId,
                objectId,
                threadId: t.name,
                isSuperFlow,
              }),
            );
          }
        }
        const childrenDirEntry = entries.find(
          (e) => e.isDirectory() && e.name === STONE_CHILDREN_SUBDIR,
        );
        if (!childrenDirEntry) return;
        const childrenDir = join(dir, STONE_CHILDREN_SUBDIR);
        let childEntries: import("node:fs").Dirent[];
        try {
          childEntries = await readdir(childrenDir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const ce of childEntries) {
          if (!ce.isDirectory()) continue;
          if (ce.name.startsWith(".")) continue;
          await walkObjectDir(join(childrenDir, ce.name), [...idSegments, ce.name]);
        }
      }

      let topEntries: import("node:fs").Dirent[];
      try {
        topEntries = await readdir(sessionRoot, { withFileTypes: true });
      } catch {
        return { items: [] };
      }
      for (const entry of topEntries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        await walkObjectDir(join(sessionRoot, entry.name), [entry.name]);
      }

      items.sort((a, b) =>
        a.objectId === b.objectId
          ? a.threadId.localeCompare(b.threadId)
          : a.objectId.localeCompare(b.objectId),
      );
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
      const payload = {
        ...thread,
        // `llm_interaction.call_started` 是 thinkloop 给崩溃恢复的磁盘锚点（recovery.ts /
        // worker 经 readThread 直读 thread.json，不走本端点），对用户/前端无意义、且每轮一条
        // 造成 trace 噪声 notice。从前端响应过滤——thread.json 原样保留，恢复链路不受影响。
        events: (thread.events ?? []).filter(
          (e) => !(e.category === "llm_interaction" && e.kind === "call_started"),
        ),
        contextWindows: enrichContextWindows(thread.contextWindows as ContextWindow[]),
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
      const talkWindows = ((userThread.contextWindows ?? []) as ContextWindow[]).filter(
        (w): w is TalkWindow => w.class === "talk" && !w.isCreatorWindow,
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
      // 扫 paused threads 并各入队一个 resume-thread job。
      // 编排抽到 runtime/resume-orchestration，与 global-pause/disable 共用同一恢复路径
      // （2026-06-05 修 pause 单向陷阱）。
      const resumed = await resumePausedThreadsInSession(
        { baseDir: deps.baseDir, jobManager: deps.jobManager },
        sessionId,
      );
      return {
        sessionId,
        paused: false,
        resumedThreadIds: resumed.map((r) => r.resumedThreadId),
        jobIds: resumed.map((r) => r.jobId),
      };
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
      // intentional: silent-swallow ban 例外——sessionId 在 loadObjectWindow 之外未直接用，
      // void 抑制 unused-var 警告，并非错误吞噬。
      void sessionId;
      let window;
      try {
        window = await loadObjectWindow({ baseDir: deps.baseDir, objectId });
      } catch (error) {
        throw new AppServerError(
          "METHOD_LOAD_FAILED",
          `failed to load object window for flow object ${objectId}: ${(error as Error).message}`,
          { sessionId, objectId, method }
        );
      }
      // HTTP call_method 只暴露 window.methods 里标了 for_ui_access 的方法（人类/client 侧专路）。
      const methods = window?.methods ?? {};
      const entry = methods[method];
      if (!entry || entry.for_ui_access !== true) {
        throw new AppServerError(
          "METHOD_NOT_FOUND",
          `method '${method}' not found or not for_ui_access on flow object '${objectId}'`,
          { sessionId, objectId, method, available: Object.keys(methods).filter((m) => methods[m].for_ui_access === true) }
        );
      }
      try {
        // HTTP 入口无 thread/manager，最小 ctx 只带 args。响应即规范化 MethodOutcome
        // ——前端从 data 字段取结构化数据、result 取消息文本。
        return normalizeMethodOutcome(await entry.exec({ args }));
      } catch (error) {
        throw new AppServerError(
          "INTERNAL_ERROR",
          `method '${method}' threw: ${(error as Error).message}`,
          { sessionId, objectId, method }
        );
      }
    },
  };
}
