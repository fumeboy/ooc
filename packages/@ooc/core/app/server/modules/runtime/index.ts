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
import type { ThreadContext, ThreadMessage } from "@ooc/builtins/agent/thread/types.js";
import { getLatestLlmObservation } from "@ooc/core/observable/index.js";

export const runtimeModule = new Elysia({ prefix: "/api/runtime" })
  // 列 session 内全部 thread
  .get("/threads/:sessionId", ({ params }) => {
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
  // 创建 thread
  .post(
    "/threads",
    async ({ body }) => {
      const { sessionId, calleeObjectId, message } = body;
      const reg = getSessionRegistry(sessionId);
      const ctor = reg.resolveConstructor(THREAD_CLASS_ID);
      if (!ctor) {
        return { error: "thread class has no constructor" };
      }
      const data = (await ctor.exec(
        { sessionId, worldDir: "", dir: "", args: { calleeObjectId, message } },
        { calleeObjectId, message },
      )) as ThreadContext;
      const instance: OocObjectInstance = {
        id: data.id,
        class: THREAD_CLASS_ID,
        data,
      };
      reg.setObject(instance);
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
  // 向 thread 推消息
  .post(
    "/threads/:threadId/messages",
    ({ params, body }) => {
      const sessionId = body.sessionId;
      const reg = getSessionRegistry(sessionId);
      const inst = reg.getObject(params.threadId);
      if (!inst) return { error: "thread not found" };
      const t = inst.data as ThreadContext;
      const msg: ThreadMessage = {
        id: `msg_${Date.now().toString(36)}`,
        content: body.content,
        createdAt: Date.now(),
        from: body.from ?? "caller",
      };
      t.messages.push(msg);
      if (t.status === "waiting") t.status = "running";
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
  .get("/observation", () => getLatestLlmObservation() ?? { empty: true });
