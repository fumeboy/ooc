import {
  createFlowObject,
  createFlowSession,
  readThread,
  writeThread,
} from "@src/persistable";
import { loadUiServerMethods } from "@src/executable/server/loader";
import type { createJobManager } from "../../runtime/job-manager";
import type { PauseStore } from "../../runtime/pause-store";
import { scanPausedThreads } from "../../runtime/thread-query";
import { applyInjectTransition, applyResumeTransition, canResumeThread } from "../../runtime/thread-transition";
import { AppServerError } from "../../bootstrap/errors";

function httpContext() {
  return {
    self: { dir: "" },
    thread: {
      id: "http",
      inject() {},
    },
  } as never;
}

export function createFlowsService(deps: {
  baseDir: string;
  pauseStore: PauseStore;
  jobManager: ReturnType<typeof createJobManager>;
}) {
  return {
    async createSession({ sessionId, title }: { sessionId: string; title?: string }) {
      await createFlowSession(deps.baseDir, sessionId, title);
      return {
        sessionId,
        dir: `${deps.baseDir}/flows/${sessionId}`,
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
      const ref = await createFlowObject({
        baseDir: deps.baseDir,
        sessionId,
        objectId,
      });
      const persistence = { ...ref, threadId: "root" } as const;
      const initialEvents = initialMessage
        ? [
            {
              category: "context_change" as const,
              kind: "inject" as const,
              text: initialMessage,
            },
          ]
        : [];
      await writeThread({
        id: "root",
        status: "running",
        events: initialEvents,
        persistence,
      });
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
      return {
        sessionId,
        objectId,
        dir: `${deps.baseDir}/flows/${sessionId}/objects/${objectId}`,
        exists: true,
      };
    },
    async getThread({ sessionId, objectId, threadId }: { sessionId: string; objectId: string; threadId: string }) {
      return await readThread({ baseDir: deps.baseDir, sessionId, objectId }, threadId);
    },
    /**
     * 向已存在的 thread 追加一条用户文本（底层仍记录为 context_change/inject 事件），
     * 把 thread.status 翻回 running，并入队一个新的 run-thread job 让 worker 续跑。
     *
     * 用于多轮对话：用户在 thread 上一轮跑完后追加新需求。
     */
    async continueThread({
      sessionId,
      objectId,
      threadId,
      text,
    }: {
      sessionId: string;
      objectId: string;
      threadId: string;
      text: string;
    }) {
      const ref = { baseDir: deps.baseDir, sessionId, objectId };
      const thread = await readThread(ref, threadId);
      if (!thread) {
        throw new AppServerError(
          "NOT_FOUND",
          `thread '${threadId}' not found`,
          { sessionId, objectId, threadId }
        );
      }
      const nextThread = applyInjectTransition(thread, text);
      await writeThread(nextThread);
      const job = deps.jobManager.createRunThreadJob({
        sessionId,
        objectId,
        threadId,
      });
      return {
        sessionId,
        objectId,
        threadId,
        status: nextThread.status,
        jobId: job.jobId,
      };
    },
    pauseSession({ sessionId }: { sessionId: string }) {
      deps.pauseStore.pauseSession(sessionId);
      return { sessionId, paused: true };
    },
    async resumeSession({ sessionId }: { sessionId: string }) {
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
      return { sessionId, resumedThreadIds, jobIds };
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
      void sessionId;
      let methods;
      try {
        methods = await loadUiServerMethods({ baseDir: deps.baseDir, objectId });
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
