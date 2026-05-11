import { readdir } from "node:fs/promises";
import { join } from "node:path";
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

/**
 * 扫 flows/{sessionId}/objects/ 下所有 object 的 threads/，
 * 返回 status=paused 的 {objectId, threadId} 列表。
 * 任一层目录不存在直接当作空集，不抛异常。
 */
async function scanPausedThreads(baseDir: string, sessionId: string): Promise<Array<{ objectId: string; threadId: string }>> {
  const objectsRoot = join(baseDir, "flows", sessionId, "objects");
  let objectDirs;
  try {
    objectDirs = await readdir(objectsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const found: Array<{ objectId: string; threadId: string }> = [];
  for (const obj of objectDirs) {
    if (!obj.isDirectory()) continue;
    const threadsDir = join(objectsRoot, obj.name, "threads");
    let threadDirs;
    try {
      threadDirs = await readdir(threadsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const td of threadDirs) {
      if (!td.isDirectory()) continue;
      const thread = await readThread({ baseDir, sessionId, objectId: obj.name }, td.name);
      if (thread?.status === "paused") {
        found.push({ objectId: obj.name, threadId: td.name });
      }
    }
  }
  return found;
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
      // 立即 status=failed，后续 inject 也救不回来。
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
      // 任何状态（done/waiting/paused/failed/running）的 thread 在收到新 user inject 后都翻回 running——
      // user 显式追加输入即意味着"继续从这里推下去"，包括从 failed 状态恢复尝试。
      thread.status = "running";
      thread.waitingType = undefined;
      thread.awaitingChildren = undefined;
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
    async resumeSession({ sessionId }: { sessionId: string }) {
      deps.pauseStore.resumeSession(sessionId);
      // 扫 paused threads 并各入队一个 resume-thread job
      const paused = await scanPausedThreads(deps.baseDir, sessionId);
      const jobIds: string[] = [];
      const resumedThreadIds: string[] = [];
      for (const { objectId, threadId } of paused) {
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
