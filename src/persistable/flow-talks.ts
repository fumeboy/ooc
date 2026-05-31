/**
 * Flow-layer talks.json IO —— 承载 B 类 talk 塌缩后的 owner-scoped 会话路由（OOC-4 L5c）。
 *
 * 路径形态：`{baseDir}/flows/{sessionId}/objects/{objectId}/talks.json`
 * （与 todos.json / plan.md / data.json 同级）。
 *
 * 语义（spec L5c plan POST-DUAL-REVIEW §6 routing-only）：
 * - talks.json **只存路由**，不存 message log。会话历史已在 thread.inbox/outbox（持久、不 drain），
 *   双写 message log 会导致渲染重复。
 * - 形态：`{ [peerObjectId]: { targetThreadId?, conversationId } }`。
 *   - peerObjectId：对端 flow object id（"user" 也是合法 peer；"super" 表示自指 super 分身）。
 *   - targetThreadId：与该 peer 会话的对端 thread id（首条派送时由 deliverMessage 回填）。
 *   - conversationId：本对会话的稳定配对键，双向消息共享，避免同 peer 多会话串话。
 * - talks 属**对象**（object-scoped），不属单个 thread——取代旧 talk_window 持有的会话路由状态。
 * - 写经 enqueueSessionWrite 串行化（仿 flow-todos.ts），同对象 read-modify-write 不丢更新。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { objectDir, toJson, type FlowObjectRef } from "./common";
import { enqueueSessionWrite } from "./serial-queue";

/** 单个 peer 的会话路由记录。 */
export interface TalkRoute {
  /** 对端 thread id；首条派送时由 deliverMessage 解析/创建并回填。 */
  targetThreadId?: string;
  /** 本对 (self, peer) 会话的稳定配对键；双向消息共享同一值。 */
  conversationId: string;
}

/** talks.json 内容：peerObjectId → 路由。 */
export type TalksRouting = Record<string, TalkRoute>;

/** flow object 的会话路由文件 `talks.json` 的绝对路径。 */
export function talksFile(ref: FlowObjectRef): string {
  return join(objectDir(ref), "talks.json");
}

/** 同对象级串行写队列 key（仿 flow-todos；同 object 的路由写严格串行）。 */
function queueKey(ref: FlowObjectRef): string {
  return `flow-talks:${ref.baseDir}:${ref.sessionId}:${ref.objectId}`;
}

/**
 * 读取 flow object 的 talks.json：
 * - 文件不存在（ENOENT）返回空对象 `{}`。
 * - 内容非对象 / JSON 解析失败抛带 path 的清晰错误。
 */
export async function readTalks(ref: FlowObjectRef): Promise<TalksRouting> {
  const file = talksFile(ref);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`flow talks.json 必须是顶层 JSON 对象，实际类型 ${Array.isArray(parsed) ? "array" : typeof parsed}`);
    }
    return parsed as TalksRouting;
  } catch (error) {
    throw new Error(
      `解析 flow talks.json 失败 (${file}): ${(error as Error).message}`,
      { cause: error },
    );
  }
}

/**
 * 整体覆盖写 talks.json：
 * - 自动 mkdir -p 父目录。
 * - 通过 enqueueSessionWrite 串行化（同对象级队列）。
 */
export async function writeTalks(ref: FlowObjectRef, routing: TalksRouting): Promise<void> {
  const file = talksFile(ref);
  await enqueueSessionWrite(queueKey(ref), async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, toJson(routing), "utf8");
  });
}

/**
 * read-modify-write 串行化：读现有 routing → 写/更新某 peer 的路由 → 写回。
 *
 * 在同对象级队列内串行（仿 mutateTodos），避免并发 lost-update。
 * 返回该 peer 写回后的最终路由记录。
 *
 * 合并语义：浅合并到既有记录——只覆盖 patch 里给出的字段，缺省字段保留既有值。
 * conversationId 缺省时若既有记录已有则保留，否则要求 caller 在首次写入时显式给出。
 */
export async function setTalkRoute(
  ref: FlowObjectRef,
  peerObjectId: string,
  patch: Partial<TalkRoute> & { conversationId?: string },
): Promise<TalkRoute> {
  const file = talksFile(ref);
  return enqueueSessionWrite(queueKey(ref), async () => {
    let existing: TalksRouting = {};
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        existing = parsed as TalksRouting;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const prev = existing[peerObjectId];
    const conversationId =
      patch.conversationId ?? prev?.conversationId;
    if (!conversationId) {
      throw new Error(
        `setTalkRoute(${peerObjectId}): 首次写入路由必须提供 conversationId（既有记录也缺）`,
      );
    }
    const next: TalkRoute = {
      conversationId,
      targetThreadId: patch.targetThreadId ?? prev?.targetThreadId,
    };
    existing[peerObjectId] = next;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, toJson(existing), "utf8");
    return next;
  });
}
