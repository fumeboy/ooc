/**
 * runtime module —— 控制面 runtime 操作端点（最小集）。
 *
 * 当前只提供：
 *   GET  /api/runtime/threads/:sessionId           — 列出 session 内所有 thread 实例
 *   POST /api/runtime/threads                       — 在某 session 创建一个新 thread（class.construct）
 *   POST /api/runtime/threads/:threadId/messages   — 向 thread 推一条消息（worker 唤醒）
 *   GET  /api/runtime/observation                   — 最近一次 LlmObservation 内存快照
 *
 * 复杂功能（pause/resume/permission-decision/loop debug）后续重建。
 */
import { Elysia, t } from "elysia";
import {
  getSessionRegistry,
  iterateSessionObjectTable,
} from "@ooc/core/runtime/object-registry.js";
import { THREAD_CLASS_ID } from "@ooc/core/types/constants.js";
import type { OocObjectInstance } from "@ooc/core/runtime/ooc-class.js";
import type { ThreadContext, ThreadMessage } from "@ooc/builtins/agent/children/thread/types.js";
import { getLatestLlmObservation } from "@ooc/core/observable/index.js";
import { hydrateSession, saveObjectData } from "@ooc/core/persistable/runtime-object-io.js";
import { enqueueScheduler } from "../../runtime/worker.js";
import { createLlmClient } from "@ooc/core/thinkable/llm/client.js";
import type { LlmClient } from "@ooc/core/thinkable/llm/types.js";

export interface RuntimeModuleConfig {
  baseDir: string;
  /** 注入一个 LlmClient (测试用 mock，生产用 createLlmClient())。 */
  llm?: LlmClient;
  /** auto-enqueue 开关 —— 创建 thread / 推消息后是否自动调度。缺省 true。 */
  autoEnqueue?: boolean;
}

export function buildRuntimeModule(config: RuntimeModuleConfig) {
  const { baseDir } = config;
  const autoEnqueue = config.autoEnqueue ?? true;
  // 懒初始化 LLM client —— 没 env 时不会抛（仅 enqueueScheduler 调时才需要）。
  let _llm: LlmClient | undefined;
  function getLlm(): LlmClient {
    if (config.llm) return config.llm;
    if (!_llm) _llm = createLlmClient();
    return _llm;
  }

  async function maybeEnqueue(sessionId: string): Promise<void> {
    if (!autoEnqueue) return;
    try {
      await enqueueScheduler(sessionId, getLlm(), baseDir);
    } catch (err) {
      // LLM env 未配置时 createLlmClient 抛错；记录但不阻塞 HTTP 响应
      console.warn(`[runtime] enqueue skipped: ${(err as Error).message}`);
    }
  }

  return new Elysia({ prefix: "/api/runtime" })
    // 列 session 内全部 thread（按需 hydrate）
    .get("/threads/:sessionId", async ({ params }) => {
      await hydrateSession(baseDir, params.sessionId);
      const threads: Array<{
        id: string;
        status: string;
        messageCount: number;
        eventCount: number;
      }> = [];
      iterateSessionObjectTable(params.sessionId, (inst) => {
        if (inst.class !== THREAD_CLASS_ID) return;
        const t = inst.data as ThreadContext;
        threads.push({
          id: t.id,
          status: t.status,
          messageCount: t.messages.length,
          eventCount: t.events.length,
        });
      });
      return { sessionId: params.sessionId, threads };
    })
    // 创建 thread + 落盘 + auto-enqueue
    .post(
      "/threads",
      async ({ body }) => {
        const { sessionId, calleeObjectId, message } = body;
        await hydrateSession(baseDir, sessionId);
        const reg = getSessionRegistry(sessionId);
        const ctor = reg.resolveConstructor(THREAD_CLASS_ID);
        if (!ctor) return { error: "thread class has no constructor" };
        const data = (await ctor.exec(
          { sessionId, worldDir: baseDir, dir: "", args: { calleeObjectId, message } },
          { calleeObjectId, message },
        )) as ThreadContext;
        const instance: OocObjectInstance = { id: data.id, class: THREAD_CLASS_ID, data };
        reg.setObject(instance);
        await saveObjectData(baseDir, sessionId, instance, reg);
        // auto-enqueue（后台异步跑）
        void maybeEnqueue(sessionId);
        return { threadId: data.id, sessionId };
      },
      {
        body: t.Object({
          sessionId: t.String(),
          calleeObjectId: t.String(),
          message: t.Optional(t.String()),
        }),
      },
    )
    // 向 thread 推消息 + 落盘 + auto-enqueue
    .post(
      "/threads/:threadId/messages",
      async ({ params, body }) => {
        const sessionId = body.sessionId;
        await hydrateSession(baseDir, sessionId);
        const reg = getSessionRegistry(sessionId);
        const inst = reg.getObject(params.threadId);
        if (!inst) return { error: "thread not found" };
        const thread = inst.data as ThreadContext;
        const msg: ThreadMessage = {
          id: `msg_${Date.now().toString(36)}`,
          content: body.content,
          createdAt: Date.now(),
          from: body.from ?? "caller",
        };
        thread.messages.push(msg);
        if (thread.status === "waiting") thread.status = "running";
        await saveObjectData(baseDir, sessionId, inst, reg);
        void maybeEnqueue(sessionId);
        return { ok: true, messageId: msg.id };
      },
      {
        body: t.Object({
          sessionId: t.String(),
          content: t.String(),
          from: t.Optional(t.Union([t.Literal("caller"), t.Literal("callee")])),
        }),
      },
    )
    // 最近 LLM 观测
    .get("/observation", () => getLatestLlmObservation() ?? { empty: true })
    // PR-Issue resolve（人类侧合入闸；issue D 落地裁决 9）
    .post(
      "/pr-issues/:id/resolve",
      async ({ params, body }) => {
        const { resolvePrIssueByHuman } = await import(
          "@ooc/builtins/agent/children/pr/approval-flow.js"
        );
        const r = await resolvePrIssueByHuman(
          baseDir,
          params.id,
          body.decision,
          body.reviewerId,
          body.comment,
        );
        if (!r.ok) return { ok: false, error: r.error };
        return { ok: true };
      },
      {
        body: t.Object({
          decision: t.Union([t.Literal("merge"), t.Literal("reject")]),
          reviewerId: t.String(),
          comment: t.Optional(t.String()),
        }),
      },
    )
    // PR-Issue 读单条（debug / 控制面用）
    .get("/pr-issues/:id", async ({ params }) => {
      const { loadPrIssue } = await import("@ooc/core/persistable/pr-issue.js");
      const record = await loadPrIssue(baseDir, params.id);
      if (!record) return { error: "not found" };
      return record;
    });
}

/** @deprecated use buildRuntimeModule(config). 留作历史兼容。 */
export const runtimeModule = buildRuntimeModule({ baseDir: "", autoEnqueue: false });
