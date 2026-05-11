import { readFile } from "node:fs/promises";
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
    async getLatestDebug(ref: ThreadPersistenceRef) {
      return {
        input: JSON.parse(await readFile(llmInputFile(ref), 'utf8')),
        output: JSON.parse(await readFile(llmOutputFile(ref), 'utf8')),
      };
    },
    async getLoopDebug(ref: ThreadPersistenceRef, loopIndex: number) {
      return {
        input: JSON.parse(await readFile(loopInputFile(ref, loopIndex), 'utf8')),
        output: JSON.parse(await readFile(loopOutputFile(ref, loopIndex), 'utf8')),
        meta: JSON.parse(await readFile(loopMetaFile(ref, loopIndex), 'utf8')),
      };
    },
  };
}
