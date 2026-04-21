/**
 * User Inbox 持久化 (session 级引用式收件箱)
 *
 * 为 user 这个「身份挂牌、不参与 ThinkLoop」的特殊对象提供 session 级 inbox：
 * 当任意对象 A 调 talk(target="user", ...) 时，world 会追加一条
 * { threadId: A的当前线程id, messageId: 本次 message_out action 的 id }
 * 到 flows/{sessionId}/user/data.json。
 *
 * 设计要点：
 * - **引用式而非复制式**：inbox 只存 (threadId, messageId) 对，不存消息正文。
 *   正文本身仍在发起对象的 thread.json.actions 和 objects/{sender}/data.json.messages 里，
 *   前端按 (threadId, messageId) 反查。保持「真数据一份，索引多份」的清晰分层。
 * - **不把 user 改造为可执行对象**：不创建 user 的线程树、不进 ThinkLoop。
 * - **session 级而非全局**：每个 session 各自一份 inbox，天然隔离。
 * - **追加式**：永远 append，不去重——同一线程给 user 发两次就是两条 inbox 条目。
 * - **串行化**：per-sessionId 的 Promise 链，防止同一 session 并发写入丢数据。
 * - **写失败不阻塞**：inbox 只是索引，上层调用方忽略异常继续走 SSE 广播。
 *
 * @ref docs/工程管理/迭代/all/20260421_feature_user_inbox.md
 * @ref kernel/src/world/world.ts — handleOnTalkToUser 是唯一调用方
 */

import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { SerialQueue } from "../utils/serial-queue.js";

/** inbox 条目：纯引用，不含正文 */
export interface UserInboxEntry {
  /** 发起对象当前线程 id（前端凭此找到 objects/{sender}/threads/{threadId}/thread.json） */
  threadId: string;
  /** message_out action 的 id（前端凭此在 thread.json.actions 里反查正文） */
  messageId: string;
}

/** user/data.json 结构（首版只有 inbox 字段，未来可能扩展 read_state 等） */
export interface UserInboxData {
  inbox: UserInboxEntry[];
}

/**
 * per-session 串行化队列（key = sessionId）
 *
 * 与旧 `_writeChains` Map 等价，但基于统一的 `SerialQueue` 工具。
 * 同一 session 的多次 append 按 FIFO 串行，不同 session 互不阻塞。
 */
const _userInboxQueue = new SerialQueue<string>();

/**
 * 获取 user/data.json 的路径
 *
 * @param flowsDir - flows/ 根目录（通常是 <OOC_ROOT>/flows）
 * @param sessionId - session id
 */
function _getUserDataJsonPath(flowsDir: string, sessionId: string): string {
  return join(flowsDir, sessionId, "user", "data.json");
}

/**
 * 读取 session 的 user inbox
 *
 * 任何异常（文件不存在、JSON 损坏、inbox 字段缺失等）均返回 { inbox: [] }，
 * 上层无需关心容错。
 *
 * @param flowsDir - flows/ 根目录
 * @param sessionId - session id
 * @returns user inbox 数据
 */
export async function readUserInbox(flowsDir: string, sessionId: string): Promise<UserInboxData> {
  const path = _getUserDataJsonPath(flowsDir, sessionId);
  if (!existsSync(path)) return { inbox: [] };
  try {
    const text = await readFile(path, "utf-8");
    const parsed = JSON.parse(text) as { inbox?: unknown };
    if (!parsed || typeof parsed !== "object") return { inbox: [] };
    if (!Array.isArray(parsed.inbox)) return { inbox: [] };
    /* 简单过滤：只保留字段齐备的条目 */
    const inbox: UserInboxEntry[] = (parsed.inbox as unknown[]).flatMap((e): UserInboxEntry[] => {
      if (!e || typeof e !== "object") return [];
      const obj = e as Record<string, unknown>;
      if (typeof obj.threadId !== "string" || typeof obj.messageId !== "string") return [];
      return [{ threadId: obj.threadId, messageId: obj.messageId }];
    });
    return { inbox };
  } catch {
    return { inbox: [] };
  }
}

/**
 * 向 session 的 user inbox 追加一条引用
 *
 * 行为：
 * 1. 确保 flows/{sessionId}/user/ 目录存在
 * 2. 读取现有 data.json（若不存在则视为 { inbox: [] }）
 * 3. 追加 { threadId, messageId } 到 inbox 末尾
 * 4. 写回 data.json（原子写）
 *
 * 所有写入通过 per-sessionId Promise 链串行化。
 *
 * @param flowsDir - flows/ 根目录
 * @param sessionId - session id
 * @param threadId - 发起对象的当前线程 id
 * @param messageId - 本次 message_out action 的 id
 */
export async function appendUserInbox(
  flowsDir: string,
  sessionId: string,
  threadId: string,
  messageId: string,
): Promise<void> {
  await _userInboxQueue.enqueue(sessionId, async () => {
    const userDir = join(flowsDir, sessionId, "user");
    if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true });

    const path = _getUserDataJsonPath(flowsDir, sessionId);
    /* 读现有数据，保留其他字段（未来扩展 read_state 等） */
    let raw: Record<string, unknown> = {};
    if (existsSync(path)) {
      try {
        raw = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
        if (!raw || typeof raw !== "object") raw = {};
      } catch {
        raw = {};
      }
    }
    const prevInbox: UserInboxEntry[] = Array.isArray(raw.inbox)
      ? (raw.inbox as unknown[]).flatMap((e): UserInboxEntry[] => {
          if (!e || typeof e !== "object") return [];
          const obj = e as Record<string, unknown>;
          if (typeof obj.threadId !== "string" || typeof obj.messageId !== "string") return [];
          return [{ threadId: obj.threadId, messageId: obj.messageId }];
        })
      : [];

    const nextData = {
      ...raw,
      inbox: [...prevInbox, { threadId, messageId }],
    };
    await writeFile(path, JSON.stringify(nextData, null, 2), "utf-8");
  });
}
