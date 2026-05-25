import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  disableDebug,
  enableDebug,
  getDebugStatus,
  notifyThreadActivated,
} from "@src/observable";
import {
  llmInputFile,
  llmOutputFile,
  loopInputFile,
  loopMetaFile,
  loopOutputFile,
  readThread,
  threadDir,
  writeThread,
  type ThreadPersistenceRef,
} from "@src/persistable";
import type { ListLoopsResponse, LoopListEntry, LoopMeta } from "./model";
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
  /**
   * R0b: 列出指定 thread 下 debug/ 目录里所有 loop_NNNN.{input,output,meta}.json
   * 文件, 按 loopIndex 升序返回. 不携带 input/output 全文 (前端按需 GET 单条).
   *
   * 退化路径 (返回 { loops: [] }, 不抛):
   * - debug/ 目录不存在 (debug 从未启用)
   * - readdir 失败 (权限错误等)
   * - persistence 缺失
   *
   * meta.json 损坏 (非合法 JSON) → 该条目 hasMeta=true 但 meta=undefined.
   */
  listLoops(ref: ThreadPersistenceRef): Promise<ListLoopsResponse>;
  /**
   * Q0c: HITL approve/reject (design §原则F + 落地分配 Q0c)。
   *
   * 接收来自控制面 / 测试 fixture 的决议, 把 thread.events 中最近一条 (或 eventId
   * 指定的) permission_ask 标记 decided + 翻 status="paused"→"running" + 调
   * notifyThreadActivated 让 worker 重新调度该 thread; thinkloop 在下一轮入口
   * 由 processDecidedPermissionAsks 消费 decided 字段, approve 直接重放, reject 写
   * permission_denied + 合成 function_call_output。
   */
  decidePermission(args: {
    ref: ThreadPersistenceRef;
    eventId?: string;
    action: "approve" | "reject";
    reason?: string;
  }): Promise<{
    ok: true;
    threadId: string;
    eventId: string;
    newStatus: "running";
  }>;
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
    async decidePermission({
      ref,
      eventId,
      action,
      reason,
    }: {
      ref: ThreadPersistenceRef;
      eventId?: string;
      action: "approve" | "reject";
      reason?: string;
    }) {
      const details = {
        sessionId: ref.sessionId,
        objectId: ref.objectId,
        threadId: ref.threadId,
      };
      const thread = await readThread(ref, ref.threadId);
      if (!thread) {
        throw new AppServerError(
          "NOT_FOUND",
          `thread '${ref.threadId}' not found`,
          details,
        );
      }
      if (thread.status !== "paused") {
        throw new AppServerError(
          "THREAD_NOT_PAUSED",
          `thread '${ref.threadId}' is not paused (current=${thread.status}); cannot accept permission decision`,
          { ...details, currentStatus: thread.status },
        );
      }
      // 找目标 permission_ask event。
      // - 给定 eventId: 精确匹配; 找不到 → 404; 已 decided → 400 already-decided
      // - 未给定: 倒序找最近一条无 decided 的 ask
      type PermAskEvent = Extract<
        (typeof thread.events)[number],
        { category: "permission"; kind: "permission_ask" }
      >;
      let target: PermAskEvent | undefined;
      if (eventId) {
        target = thread.events.find(
          (e): e is PermAskEvent =>
            e.category === "permission" &&
            e.kind === "permission_ask" &&
            e.id === eventId,
        );
        if (!target) {
          throw new AppServerError(
            "NOT_FOUND",
            `permission_ask event '${eventId}' not found on thread '${ref.threadId}'`,
            { ...details, eventId },
          );
        }
        if (target.decided) {
          throw new AppServerError(
            "CONFLICT",
            `permission_ask event '${eventId}' already decided (action=${target.decided.action})`,
            { ...details, eventId, existingDecision: target.decided.action },
          );
        }
      } else {
        for (let i = thread.events.length - 1; i >= 0; i -= 1) {
          const ev = thread.events[i];
          if (
            ev.category === "permission" &&
            ev.kind === "permission_ask" &&
            !ev.decided
          ) {
            target = ev as PermAskEvent;
            break;
          }
        }
        if (!target) {
          throw new AppServerError(
            "INVALID_INPUT",
            `no pending permission_ask event on thread '${ref.threadId}'`,
            details,
          );
        }
      }
      // 标 decided + 翻 status + writeThread
      target.decided = {
        action,
        at: Date.now(),
        ...(reason !== undefined ? { reason } : {}),
      };
      // 为 event 分配稳定 id (用于本次返回值; 若没有 id 字段则赋一个)。
      // 缺省策略: 用 toolCallId + "-ask" 作 fallback (toolCallId 在 thread.events 中
      // 仅出现一次, 在 permission_ask + function_call_output 间复用 — 给本 event 一个
      // 派生 id 即可)。
      if (!target.id) {
        target.id = `${target.toolCallId}_ask`;
      }
      const updated = {
        ...thread,
        status: "running" as const,
      };
      await writeThread(updated);
      // 触发 worker 调度 (与 talk-delivery / end auto-reply 同款唤醒路径)
      notifyThreadActivated({
        sessionId: ref.sessionId,
        objectId: ref.objectId,
        threadId: ref.threadId,
      });
      return {
        ok: true as const,
        threadId: ref.threadId,
        eventId: target.id,
        newStatus: "running" as const,
      };
    },
    async getLoopDebug(ref: ThreadPersistenceRef, loopIndex: number) {
      const details = {
        sessionId: ref.sessionId,
        objectId: ref.objectId,
        threadId: ref.threadId,
        loopIndex,
      };
      // Round 8 B5: label 与磁盘 zero-pad 4 位文件名对齐（loop_0001.*.json），
      // 而不是用裸 loopIndex（如 loop_1）——后者让错误信息无法直接指向文件。
      const padded = String(loopIndex).padStart(4, "0");
      return {
        input: await readDebugJson(loopInputFile(ref, loopIndex), `loop_${padded}.input.json`, details),
        output: await readDebugJson(loopOutputFile(ref, loopIndex), `loop_${padded}.output.json`, details),
        meta: await readDebugJson(loopMetaFile(ref, loopIndex), `loop_${padded}.meta.json`, details),
      };
    },
    async listLoops(ref: ThreadPersistenceRef): Promise<ListLoopsResponse> {
      const dir = join(threadDir(ref), "debug");
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch (error) {
        // 退化路径: ENOENT (debug 目录不存在) / EACCES (权限) / ENOTDIR / 其它 fs 错
        // 一律视为 "无 loop 数据", 返回空数组而非 throw — 让前端在 debug 关闭场景
        // 也能拿到稳定的 200 响应.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { loops: [] };
        }
        return { loops: [] };
      }

      // 按 loopIndex 聚合 input/output/meta 三类文件
      const loopMap = new Map<number, LoopListEntry>();
      const metaFiles = new Map<number, string>(); // loopIndex → meta 文件名 (用于第二轮读)

      // 匹配 loop_NNNN.{input|output|meta}.json (允许 NNNN 是任意长度数字, 与
      // formatLoopIndex 的 4 位 padStart 兼容但不强绑死).
      const pattern = /^loop_(\d+)\.(input|output|meta)\.json$/;
      for (const fname of entries) {
        const match = pattern.exec(fname);
        if (!match) continue;
        const loopIndex = Number.parseInt(match[1]!, 10);
        if (!Number.isFinite(loopIndex)) continue;
        const kind = match[2] as "input" | "output" | "meta";
        const current = loopMap.get(loopIndex) ?? {
          loopIndex,
          hasInput: false,
          hasOutput: false,
          hasMeta: false,
        };
        const next: LoopListEntry = {
          ...current,
          ...(kind === "input" ? { hasInput: true } : {}),
          ...(kind === "output" ? { hasOutput: true } : {}),
          ...(kind === "meta" ? { hasMeta: true } : {}),
        };
        loopMap.set(loopIndex, next);
        if (kind === "meta") {
          metaFiles.set(loopIndex, fname);
        }
      }

      // 读取所有 meta.json (并行); 损坏的 meta → 该条目 meta 字段保持 undefined,
      // hasMeta 仍为 true (区分 "存在但损坏" vs "不存在").
      const loops: LoopListEntry[] = [];
      const sortedIndices = Array.from(loopMap.keys()).sort((a, b) => a - b);
      const reads = await Promise.all(
        sortedIndices.map(async (idx): Promise<LoopMeta | undefined> => {
          const fname = metaFiles.get(idx);
          if (!fname) return undefined;
          try {
            const raw = await readFile(join(dir, fname), "utf8");
            return JSON.parse(raw) as LoopMeta;
          } catch {
            // meta 文件损坏 / 读失败 → 返回 undefined, 不抛
            return undefined;
          }
        }),
      );
      for (let i = 0; i < sortedIndices.length; i += 1) {
        const idx = sortedIndices[i]!;
        const entry = loopMap.get(idx)!;
        const meta = reads[i];
        loops.push(meta !== undefined ? { ...entry, meta } : entry);
      }
      return { loops };
    },
  };
}
