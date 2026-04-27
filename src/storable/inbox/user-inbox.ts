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

import { SerialQueue } from "../../shared/utils/serial-queue.js";

/** inbox 条目：纯引用，不含正文 */
export interface UserInboxEntry {
  /** 发起对象当前线程 id（前端凭此找到 objects/{sender}/threads/{threadId}/thread.json） */
  threadId: string;
  /** message_out action 的 id（前端凭此在 thread.json.actions 里反查正文） */
  messageId: string;
}

/**
 * 用户已读状态（按对象记录最后读到的时间戳）
 *
 * 前端切换到某对象的线程时上报"我读到 ts=X 为止"，后端按 objectName 记录
 * 单调递增的 `lastReadTimestamp`。unread 的判定由前端完成：某对象的 thread
 * 消息 timestamp > lastReadTimestamp 即未读。
 */
export interface UserReadState {
  /** 每个对象最后已读消息的 timestamp（对象名 → epoch ms） */
  lastReadTimestampByObject: Record<string, number>;
}

/** user/data.json 结构：inbox（引用式）+ readState（已读进度） */
export interface UserInboxData {
  inbox: UserInboxEntry[];
  readState: UserReadState;
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

/** 默认空 readState */
const EMPTY_READ_STATE: UserReadState = { lastReadTimestampByObject: {} };

/**
 * 从 raw JSON 解析 inbox[]（过滤掉字段不全的条目）
 */
function _parseInboxArray(raw: Record<string, unknown>): UserInboxEntry[] {
  if (!Array.isArray(raw.inbox)) return [];
  return (raw.inbox as unknown[]).flatMap((e): UserInboxEntry[] => {
    if (!e || typeof e !== "object") return [];
    const obj = e as Record<string, unknown>;
    if (typeof obj.threadId !== "string" || typeof obj.messageId !== "string") return [];
    return [{ threadId: obj.threadId, messageId: obj.messageId }];
  });
}

/**
 * 从 raw JSON 解析 readState（宽松解析：字段不全时返回空对象）
 */
function _parseReadState(raw: Record<string, unknown>): UserReadState {
  const rs = raw.readState;
  if (!rs || typeof rs !== "object") return { lastReadTimestampByObject: {} };
  const obj = (rs as Record<string, unknown>).lastReadTimestampByObject;
  if (!obj || typeof obj !== "object") return { lastReadTimestampByObject: {} };
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) result[k] = v;
  }
  return { lastReadTimestampByObject: result };
}

/**
 * 读取 session 的 user data.json 并返回完整解析结果
 *
 * 任何异常（文件不存在、JSON 损坏等）均返回默认值，上层无需关心容错。
 */
async function _readRaw(flowsDir: string, sessionId: string): Promise<Record<string, unknown>> {
  const path = _getUserDataJsonPath(flowsDir, sessionId);
  if (!existsSync(path)) return {};
  try {
    const text = await readFile(path, "utf-8");
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * 读取 session 的 user inbox（含 readState）
 *
 * 任何异常均返回 `{ inbox: [], readState: { lastReadTimestampByObject: {} } }`。
 *
 * @param flowsDir - flows/ 根目录
 * @param sessionId - session id
 * @returns user inbox 数据
 */
export async function readUserInbox(flowsDir: string, sessionId: string): Promise<UserInboxData> {
  const raw = await _readRaw(flowsDir, sessionId);
  return {
    inbox: _parseInboxArray(raw),
    readState: _parseReadState(raw),
  };
}

/**
 * 读取仅 readState 字段（便捷方法，内部仍读整个 data.json）
 */
export async function readUserReadState(flowsDir: string, sessionId: string): Promise<UserReadState> {
  const raw = await _readRaw(flowsDir, sessionId);
  return _parseReadState(raw);
}

/**
 * 向 session 的 user inbox 追加一条引用
 *
 * 行为：
 * 1. 确保 flows/{sessionId}/user/ 目录存在
 * 2. 读取现有 data.json（若不存在则视为 {}）
 * 3. 追加 { threadId, messageId } 到 inbox 末尾
 * 4. 写回 data.json（原子写）
 *
 * 所有写入通过 per-sessionId SerialQueue 串行化。
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
    const raw = await _readRaw(flowsDir, sessionId);
    const prevInbox = _parseInboxArray(raw);
    const prevReadState = _parseReadState(raw);

    const nextData = {
      ...raw,
      inbox: [...prevInbox, { threadId, messageId }],
      /* readState 保持原样（只读） */
      readState: prevReadState.lastReadTimestampByObject && Object.keys(prevReadState.lastReadTimestampByObject).length > 0
        ? prevReadState
        : (raw.readState ?? EMPTY_READ_STATE),
    };
    await writeFile(path, JSON.stringify(nextData, null, 2), "utf-8");
  });
}

/**
 * 更新某对象的 `lastReadTimestamp`（单调递增：只在传入 ts 更大时才更新）
 *
 * 行为：
 * 1. 确保 flows/{sessionId}/user/ 目录存在
 * 2. 读取现有 data.json（未初始化时视为 {}）
 * 3. 若 `readState.lastReadTimestampByObject[objectName]` 已存在且 >= timestamp，
 *    不做改动（保证单调递增，防止前端乱序上报造成回退）
 * 4. 否则写入新值，保留 inbox 和其他字段
 *
 * 所有写入通过同一 `_userInboxQueue` 串行化，保证同 session 的 append 与
 * set 操作不会互相覆盖。
 *
 * @param flowsDir - flows/ 根目录
 * @param sessionId - session id
 * @param objectName - 对象名（如 "bruce"）
 * @param timestamp - 本次已读的最大消息 timestamp
 */
export async function setUserReadObject(
  flowsDir: string,
  sessionId: string,
  objectName: string,
  timestamp: number,
): Promise<void> {
  await _userInboxQueue.enqueue(sessionId, async () => {
    const userDir = join(flowsDir, sessionId, "user");
    if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true });

    const path = _getUserDataJsonPath(flowsDir, sessionId);
    const raw = await _readRaw(flowsDir, sessionId);
    const prevInbox = _parseInboxArray(raw);
    const prevReadState = _parseReadState(raw);

    const prevTs = prevReadState.lastReadTimestampByObject[objectName] ?? 0;
    if (prevTs >= timestamp) return; /* 单调递增，忽略回退 */

    const nextReadState: UserReadState = {
      lastReadTimestampByObject: {
        ...prevReadState.lastReadTimestampByObject,
        [objectName]: timestamp,
      },
    };

    const nextData = {
      ...raw,
      inbox: prevInbox,
      readState: nextReadState,
    };
    await writeFile(path, JSON.stringify(nextData, null, 2), "utf-8");
  });
}
