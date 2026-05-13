import { readFile } from "node:fs/promises";
import { disableDebug, enableDebug, getDebugStatus } from "@src/observable";
import {
  llmInputFile,
  llmOutputFile,
  loopInputFile,
  loopMetaFile,
  loopOutputFile,
  type ThreadPersistenceRef,
} from "@src/persistable";
import { readLlmEnv } from "@src/thinkable/llm/env";
import type { PauseStore } from "../../runtime/pause-store";
import type { createJobManager } from "../../runtime/job-manager";
import type { RuntimeJob } from "../../runtime/types";
import { AppServerError } from "../../bootstrap/errors";

/** 读 debug JSON：缺失 → 404 NOT_FOUND；损坏 → 500 INTERNAL_ERROR。 */
async function readDebugJson(file: string, label: string, details: Record<string, unknown>): Promise<unknown> {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AppServerError(
        "NOT_FOUND",
        `debug file '${label}' not found`,
        { ...details, file }
      );
    }
    throw new AppServerError(
      "INTERNAL_ERROR",
      `failed to read debug file '${label}': ${(error as Error).message}`,
      { ...details, file }
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new AppServerError(
      "INTERNAL_ERROR",
      `debug file '${label}' contains invalid JSON: ${(error as Error).message}`,
      { ...details, file }
    );
  }
}

export interface RuntimeService {
  getLlmConfig(): {
    configured: boolean;
    provider: string;
    baseUrl: string;
    model: string;
    error?: string;
  };
  listJobs(): { items: RuntimeJob[] };
  getJob(jobId: string): RuntimeJob | undefined;
  enableGlobalPause(): { enabled: true };
  disableGlobalPause(): { enabled: false };
  getGlobalPauseStatus(): { enabled: boolean };
  enableDebug(): { enabled: true };
  disableDebug(): { enabled: false };
  getDebugStatus(): { enabled: boolean };
  getLatestDebug(ref: ThreadPersistenceRef): Promise<{ input: unknown; output: unknown }>;
  getLoopDebug(ref: ThreadPersistenceRef, loopIndex: number): Promise<{ input: unknown; output: unknown; meta: unknown }>;
}

export function createRuntimeService(deps: {
  pauseStore: PauseStore;
  jobManager: ReturnType<typeof createJobManager>;
}): RuntimeService {
  return {
    getLlmConfig() {
      try {
        const config = readLlmEnv();
        return {
          configured: true,
          provider: config.provider,
          baseUrl: config.baseUrl,
          model: config.model,
        };
      } catch (error) {
        return {
          configured: false,
          provider: process.env.OOC_PROVIDER ?? "openai",
          baseUrl: process.env.OOC_BASE_URL ?? "",
          model: process.env.OOC_MODEL ?? "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    listJobs() {
      return { items: deps.jobManager.listJobs() };
    },
    getJob(jobId: string) {
      return deps.jobManager.getJob(jobId);
    },
    enableGlobalPause() {
      deps.pauseStore.enableGlobalPause();
      return { enabled: true as const };
    },
    disableGlobalPause() {
      deps.pauseStore.disableGlobalPause();
      return { enabled: false as const };
    },
    getGlobalPauseStatus() {
      return { enabled: deps.pauseStore.isGlobalPauseEnabled() };
    },
    enableDebug() {
      enableDebug();
      return { enabled: true as const };
    },
    disableDebug() {
      disableDebug();
      return { enabled: false as const };
    },
    getDebugStatus() {
      return getDebugStatus();
    },
    async getLatestDebug(ref: ThreadPersistenceRef) {
      const details = {
        sessionId: ref.sessionId,
        objectId: ref.objectId,
        threadId: ref.threadId,
      };
      return {
        input: await readDebugJson(llmInputFile(ref), "llm.input.json", details),
        output: await readDebugJson(llmOutputFile(ref), "llm.output.json", details),
      };
    },
    async getLoopDebug(ref: ThreadPersistenceRef, loopIndex: number) {
      const details = {
        sessionId: ref.sessionId,
        objectId: ref.objectId,
        threadId: ref.threadId,
        loopIndex,
      };
      return {
        input: await readDebugJson(loopInputFile(ref, loopIndex), `loop_${loopIndex}.input.json`, details),
        output: await readDebugJson(loopOutputFile(ref, loopIndex), `loop_${loopIndex}.output.json`, details),
        meta: await readDebugJson(loopMetaFile(ref, loopIndex), `loop_${loopIndex}.meta.json`, details),
      };
    },
  };
}
