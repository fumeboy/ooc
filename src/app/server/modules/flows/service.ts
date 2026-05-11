import {
  createFlowObject,
  createFlowSession,
  readThread,
  writeThread,
} from "@src/persistable";
import { loadUiServerMethods } from "@src/executable/server/loader";
import type { createJobManager } from "../../runtime/job-manager";
import type { PauseStore } from "../../runtime/pause-store";
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
    async createFlowObject({ sessionId, objectId }: { sessionId: string; objectId: string }) {
      const ref = await createFlowObject({
        baseDir: deps.baseDir,
        sessionId,
        objectId,
      });
      const persistence = { ...ref, threadId: "root" } as const;
      await writeThread({
        id: "root",
        status: "running",
        events: [],
        persistence,
      });
      const job = deps.jobManager.createRunThreadJob({
        sessionId,
        objectId,
        threadId: "root",
      });
      return {
        sessionId,
        objectId,
        dir: `${deps.baseDir}/flows/${sessionId}/objects/${objectId}`,
        created: true,
        initialThreadId: "root",
        jobId: job.jobId,
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
     * 向已存在的 thread 注入一条用户文本（作为 context_change/inject 事件），
     * 把 thread.status 翻回 running，并入队一个新的 run-thread job 让 worker 续跑。
     *
     * 用于多轮对话：用户在 thread 上一轮跑完后追加新需求。
     */
    async injectThread({
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
      thread.events.push({
        category: "context_change",
        kind: "inject",
        text,
      });
      // failed 线程不再自动唤醒——失败原因可能是不可恢复的；其它（done/waiting/paused/running）都翻回 running
      if (thread.status !== "failed") {
        thread.status = "running";
        thread.waitingType = undefined;
        thread.awaitingChildren = undefined;
      }
      await writeThread(thread);
      const job = deps.jobManager.createRunThreadJob({
        sessionId,
        objectId,
        threadId,
      });
      return {
        sessionId,
        objectId,
        threadId,
        status: thread.status,
        jobId: job.jobId,
      };
    },
    pauseSession({ sessionId }: { sessionId: string }) {
      deps.pauseStore.pauseSession(sessionId);
      return { sessionId, paused: true };
    },
    resumeSession({ sessionId }: { sessionId: string }) {
      deps.pauseStore.resumeSession(sessionId);
      return { sessionId, resumedThreadIds: [], jobIds: [] };
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
