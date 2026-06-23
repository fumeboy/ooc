/**
 * Inbox 独立存储（collaborable 并发回报竞态根治）—— thread builtin 自有持久化逻辑。
 *
 * thread 是 builtin object：它的会话 inbox 怎么落盘是 thread 自己的逻辑，不属 core
 * （object-model 核心 7）。原 `core/persistable/inbox-store.ts` 已退潮收纳到此。
 *
 * 问题：inbox 此前随 thread.json 整体 read-modify-write。worker 持 caller in-memory
 * 跑很久（含 LLM），期间外部 deliverTalkMessage / syncCrossObjectCalleeEnds 对 caller.inbox
 * 的 append 被 worker 最终整体 writeThread 覆盖 → 并发回报丢正文（N 个 callee 同时回报
 * caller 时，第二路正文静默丢失）。per-thread 锁锁不住 worker 的长 runJob。
 *
 * 解法：inbox 是 append-only（消费靠 consumedMessageIds 派生过滤，无物理移除），故拆成
 * `<threadDir>/inbox/<msgId>.json` per-message 文件存储——
 *   - 写：每条消息独立文件，不同 msgId 不同文件 → 并发 append 互不覆盖；已存在不重写（幂等）。
 *   - 读：readThread 扫目录全量合并进 thread.inbox。
 *   - writeThread 把 in-memory inbox **append** 到目录（只增不删），故 worker 的 stale
 *     in-memory inbox（少了并发新增）writeThread 时不会删掉并发写入的消息文件 → 根治覆盖。
 *
 * thread.json 不再持久化 inbox 字段（writeThread strip），目录是唯一权威。
 */

import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { threadDir, type ThreadPersistenceRef } from "@ooc/core/persistable/common.js";
import type { ThreadMessage } from "@ooc/builtins/agent/thread/types.js";

/** `<threadDir>/inbox/` —— per-message 文件目录。 */
export function inboxDir(ref: ThreadPersistenceRef): string {
  return join(threadDir(ref), "inbox");
}

/**
 * 把 in-memory inbox 消息 append 到目录（append-only，幂等）。
 * 每条写 `<inboxDir>/<msgId>.json`；已存在的 msgId **不重写**（不覆盖并发写入）。
 * 只增不删——调用方传 stale inbox 也不会抹掉目录里别处并发新增的消息。
 */
export async function persistInboxMessages(
  ref: ThreadPersistenceRef,
  messages: ThreadMessage[] | undefined,
): Promise<void> {
  if (!messages || messages.length === 0) return;
  const dir = inboxDir(ref);
  await mkdir(dir, { recursive: true });
  for (const msg of messages) {
    if (!msg?.id) continue;
    const f = join(dir, `${msg.id}.json`);
    try {
      await stat(f);
      continue; // 已存在 → append-only 幂等跳过
    } catch {
      // 不存在 → 写入
    }
    await writeFile(f, JSON.stringify(msg), "utf8");
  }
}

/**
 * 读 `<threadDir>/inbox/` 全部消息，按 createdAt 升序。目录不存在 → []。
 * 单个文件损坏（JSON parse 失败）跳过并 warn，不阻塞整个 readThread。
 */
export async function readInboxMessages(
  ref: ThreadPersistenceRef,
): Promise<ThreadMessage[]> {
  const dir = inboxDir(ref);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return []; // 目录不存在（无 inbox）
  }
  const msgs: ThreadMessage[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      msgs.push(JSON.parse(await readFile(join(dir, name), "utf8")) as ThreadMessage);
    } catch (e) {
      console.warn(`[readInboxMessages] 跳过损坏的 inbox 文件 ${name}: ${(e as Error).message}`);
    }
  }
  msgs.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return msgs;
}
