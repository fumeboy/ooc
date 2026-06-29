/**
 * flows module — flow session 操作的 server module。
 *
 * **issue S2 (2026-06-29)**: 首批端点 — visible/server callMethod 入口
 *   POST /api/flows/:sid/:oid/call_method body={method, args?}
 *
 * **issue S6 (2026-06-29)**: thread list/detail
 *   GET /api/flows/:sid/threads — list per session
 *   GET /api/flows/:sid/:oid/threads/:tid — single thread 详情 (ThreadContext)
 *
 * 设计权威: index.md §B ## visible / visible/self.md ## 核心设计:
 *   "HTTP /call_method dispatch 到 visible/server — **仅 flow scope**, stone scope 只读"
 *
 * 后续 issue 加更多 endpoint:
 *   - S4: GET /api/flows, POST /api/flows/:sid/pause, POST /api/flows/:sid/resume
 *   - S5: POST /api/flows/:sid/talk-windows, POST /api/flows/:sid/continue
 */
import { Elysia, t } from "elysia";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  getSessionRegistry,
  iterateSessionObjectTable,
} from "@ooc/core/runtime/object-registry.js";
import { hydrateSession, saveObjectData } from "@ooc/core/persistable/runtime-object-io.js";
import { THREAD_CLASS_ID } from "@ooc/core/types/constants.js";
import type { ThreadContext } from "@ooc/builtins/agent/children/thread/types.js";
import {
  addTalkWindowOnSession,
  continueOnSession,
} from "../sessions/index.js";
import { enqueueScheduler } from "../../runtime/worker.js";
import {
  pauseSession as pauseSessionStore,
  resumeSession as resumeSessionStore,
  isSessionPaused,
} from "../../runtime/pause-store.js";
import { createLlmClient } from "@ooc/core/thinkable/llm/client.js";
import type { LlmClient } from "@ooc/core/thinkable/llm/types.js";
import type { WorldRuntime } from "@ooc/core/runtime/world-runtime.js";

export interface FlowsModuleConfig {
  baseDir: string;
  llm?: LlmClient;
  autoEnqueue?: boolean;
  worldRuntime?: WorldRuntime;
}

export function buildFlowsModule(config: FlowsModuleConfig) {
  const { baseDir } = config;
  const autoEnqueue = config.autoEnqueue ?? true;
  let _llm: LlmClient | undefined;
  function getLlm(): LlmClient {
    if (config.llm) return config.llm;
    if (!_llm) _llm = createLlmClient();
    return _llm;
  }
  async function maybeEnqueue(sessionId: string): Promise<void> {
    if (!autoEnqueue) return;
    try {
      await enqueueScheduler(sessionId, getLlm(), baseDir, config.worldRuntime?.reloadTable);
    } catch (err) {
      console.warn(`[flows] enqueue skipped: ${(err as Error).message}`);
    }
  }

  return new Elysia({ prefix: "/api/flows" })
    .post(
      "/:sid/:oid/call_method",
      async ({ params, body, set }) => {
        const { sid, oid } = params;
        const methodName = body.method;
        const args = body.args ?? {};

        await hydrateSession(baseDir, sid);
        const reg = getSessionRegistry(sid);

        const inst = reg.getObject(oid);
        if (!inst) {
          set.status = 404;
          return { ok: false, error: { code: "OBJECT_NOT_FOUND", message: `object not found in session ${sid}: ${oid}` } };
        }

        const visibleServer = reg.resolveVisibleServer(inst.class);
        if (!visibleServer) {
          set.status = 400;
          return {
            ok: false,
            error: {
              code: "NO_VISIBLE_SERVER",
              message: `class ${inst.class} has no visible/server module`,
            },
          };
        }

        const method = visibleServer.methods.find((m) => m.name === methodName);
        if (!method) {
          set.status = 404;
          return {
            ok: false,
            error: {
              code: "METHOD_NOT_FOUND",
              message: `visible/server method '${methodName}' not found on class ${inst.class}`,
            },
          };
        }

        try {
          let dirty = false;
          const result = await method.exec(
            {
              baseDir,
              session: { baseDir, sessionId: sid },
              object: { id: inst.id, class: inst.class },
              reportDataEdit: async () => {
                dirty = true;
              },
              args,
            },
            inst.data,
            args,
          );
          if (dirty) {
            await saveObjectData(baseDir, sid, inst, reg);
          }
          return { ok: true, data: result };
        } catch (err) {
          set.status = 500;
          return {
            ok: false,
            error: {
              code: "METHOD_EXEC_FAILED",
              message: (err as Error).message,
            },
          };
        }
      },
      {
        body: t.Object({
          method: t.String(),
          args: t.Optional(t.Record(t.String(), t.Any())),
        }),
      },
    )
    // S6: list threads per session
    .get(
      "/:sid/threads",
      async ({ params }) => {
        await hydrateSession(baseDir, params.sid);
        const items: Array<{
          objectId: string;
          threadId: string;
          status: string;
          messageCount: number;
          eventCount: number;
          lastEventAt?: number;
          calleeObjectId?: string;
          skipScheduling?: boolean;
        }> = [];
        iterateSessionObjectTable(params.sid, (inst) => {
          if (inst.class !== THREAD_CLASS_ID) return;
          const t = inst.data as ThreadContext & { skip_scheduling?: boolean };
          const lastMsg = t.messages[t.messages.length - 1]?.createdAt;
          const lastEvt = t.events[t.events.length - 1]?.createdAt;
          const lastEventAt = Math.max(lastMsg ?? 0, lastEvt ?? 0) || undefined;
          items.push({
            objectId: t.calleeObjectId ?? "",
            threadId: t.id,
            status: t.status,
            messageCount: t.messages.length,
            eventCount: t.events.length,
            lastEventAt,
            calleeObjectId: t.calleeObjectId,
            skipScheduling: t.skip_scheduling,
          });
        });
        return { sessionId: params.sid, items };
      },
    )
    // S6: single thread detail
    .get(
      "/:sid/:oid/threads/:tid",
      async ({ params, set }) => {
        await hydrateSession(baseDir, params.sid);
        const reg = getSessionRegistry(params.sid);
        const inst = reg.getObject(params.tid);
        if (!inst || inst.class !== THREAD_CLASS_ID) {
          set.status = 404;
          return {
            ok: false,
            error: {
              code: "THREAD_NOT_FOUND",
              message: `thread not found in session ${params.sid}: ${params.tid}`,
            },
          };
        }
        return inst.data as ThreadContext;
      },
    )
    // S5: POST /api/flows/:sid/talk-windows — 在已存在 session 上加新 target thread + push 进 user.root.contextWindows
    .post(
      "/:sid/talk-windows",
      async ({ params, body, set }) => {
        try {
          const result = await addTalkWindowOnSession({
            baseDir,
            sessionId: params.sid,
            targetObjectId: body.targetObjectId,
            initialMessage: body.initialMessage,
          });
          if (!result.ok) {
            set.status = result.error.code === "USER_NOT_FOUND" ? 404 : 400;
            return result;
          }
          if (result.created && body.initialMessage) {
            void maybeEnqueue(params.sid);
          }
          return result;
        } catch (err) {
          set.status = 500;
          return {
            ok: false,
            error: { code: "INTERNAL", message: (err as Error).message, stack: (err as Error).stack },
          };
        }
      },
      {
        body: t.Object({
          targetObjectId: t.String(),
          initialMessage: t.Optional(t.String()),
        }),
      },
    )
    // S5: POST /api/flows/:sid/continue — user 经 user.root 投递消息到 target thread + 唤醒
    .post(
      "/:sid/continue",
      async ({ params, body, set }) => {
        try {
          const result = await continueOnSession({
            baseDir,
            sessionId: params.sid,
            text: body.text,
            targetWindowId: body.targetWindowId,
          });
          if (!result.ok) {
            set.status =
              result.error.code === "USER_NOT_FOUND" ? 404 :
              result.error.code === "TARGET_THREAD_NOT_FOUND" ? 404 :
              400;
            return result;
          }
          void maybeEnqueue(params.sid);
          return result;
        } catch (err) {
          set.status = 500;
          return {
            ok: false,
            error: { code: "INTERNAL", message: (err as Error).message, stack: (err as Error).stack },
          };
        }
      },
      {
        body: t.Object({
          text: t.String(),
          targetWindowId: t.Optional(t.String()),
        }),
      },
    )
    // S4: GET /api/flows — list all sessions
    .get(
      "",
      async () => {
        const flowsRoot = join(baseDir, "flows");
        let entries;
        try {
          entries = await readdir(flowsRoot, { withFileTypes: true });
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") return { items: [], hash: "0" };
          throw e;
        }
        const items: Array<{
          sessionId: string;
          paused?: boolean;
          updatedAt?: number;
          title?: string;
        }> = [];
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          if (e.name.startsWith(".")) continue;
          const sid = e.name;
          let updatedAt: number | undefined;
          try {
            const st = await stat(join(flowsRoot, sid));
            updatedAt = st.mtimeMs;
          } catch {
            // ignore
          }
          items.push({
            sessionId: sid,
            paused: isSessionPaused(sid) || undefined,
            updatedAt,
          });
        }
        // 简单 list-level hash (基于 ids + mtime), 用于轮询去抖
        const hash = items
          .map((i) => `${i.sessionId}:${i.updatedAt ?? 0}:${i.paused ? 1 : 0}`)
          .join("|");
        return { items, hash };
      },
    )
    // S4: POST /api/flows/:sid/pause — 进程内 pause
    .post(
      "/:sid/pause",
      async ({ params }) => {
        pauseSessionStore(params.sid);
        return { sessionId: params.sid, paused: true as const };
      },
    )
    // S4: POST /api/flows/:sid/resume — 进程内 resume + 扫待推进 thread 重新入队
    .post(
      "/:sid/resume",
      async ({ params }) => {
        resumeSessionStore(params.sid);
        // 扫 session 内 running/waiting (非 skip_scheduling) thread, 重启入队
        await hydrateSession(baseDir, params.sid);
        const resumedThreadIds: string[] = [];
        const jobIds: string[] = [];
        iterateSessionObjectTable(params.sid, (inst) => {
          if (inst.class !== THREAD_CLASS_ID) return;
          const t = inst.data as ThreadContext;
          if (t.skip_scheduling) return;
          if (t.status === "running" || t.status === "waiting") {
            resumedThreadIds.push(t.id);
          }
        });
        // 唤醒 worker (尝试入队, 若 LLM env 缺失则 console.warn 不阻塞)
        void maybeEnqueue(params.sid);
        return {
          sessionId: params.sid,
          paused: false as const,
          resumedThreadIds,
          jobIds,
        };
      },
    );
}
