import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { threadDir, toJson, type FlowObjectRef, type ThreadPersistenceRef } from "./common";
import type { ThreadContext } from "../thinkable/context";
import { initContextWindows } from "../executable/windows/_shared/init";
import { listRegisteredWindowTypes } from "../executable/windows/_shared/registry";

/**
 * thread.json 的最小读写。
 *
 * Step 3（spec 2026-05-14 § 迁移节奏 Step 3）：移除 Step 1 的 LegacyThreadJson 兼容层。
 * 反序列化后只做一件兜底：若 contextWindows 缺 creator do_window，自动补一个
 * （历史数据可能缺，新数据 init 时一定有）。
 */

/** 单个线程的 `thread.json` 绝对路径。 */
export function threadFile(ref: ThreadPersistenceRef): string {
  return join(threadDir(ref), "thread.json");
}

/**
 * 持久化前剥离 in-process 内存字段。
 *
 * 当前规则:
 * - compressLevel = 0 / undefined 是默认值,不进 thread.json,避免在所有历史 window
 *   上增加噪音字段(design §risk)
 * - _decayMeta 是 budget.applyNaturalDecay 的运行时计数器(下划线前缀),不进 thread.json;
 *   下一次启动后从 0 重新计数即可——衰减语义是 "持续 N 轮无访问",冷启动重置不会引起错误折叠
 *
 * P0f note: ProcessEvent._foldedBy 同样下划线前缀但**保留**进 thread.json
 *   (fold 状态的唯一锚点,strip 掉会导致 reload 后折叠丢失)。
 *
 * 历史: 2026-05-26 移除 IssueWindow lastSeenCommentId / lastNotifiedAt 的 strip 逻辑
 *   (issue 看板已整体移除)。
 */
function stripVolatileForPersist(thread: ThreadContext): ThreadContext {
  return {
    ...thread,
    contextWindows: thread.contextWindows.map((window) => {
      let next = window;
      if (!next.compressLevel) {
        const { compressLevel: _drop, ...rest } = next;
        next = rest as typeof next;
      }
      if (next._decayMeta !== undefined) {
        const { _decayMeta: _drop, ...rest } = next;
        next = rest as typeof next;
      }
      return next;
    }),
  };
}

/** 把线程上下文持久化到 `thread.json`；线程未携带 persistence ref 时静默跳过。 */
export async function writeThread(thread: ThreadContext): Promise<void> {
  if (!thread.persistence) return;
  await mkdir(threadDir(thread.persistence), { recursive: true });
  const sanitized = stripVolatileForPersist(thread);
  await writeFile(threadFile(thread.persistence), toJson(sanitized), "utf8");
}

/** 从磁盘恢复线程上下文，并把 persistence ref 重新挂上。 */
export async function readThread(
  ref: FlowObjectRef,
  threadId: string,
): Promise<ThreadContext | undefined> {
  const persistence: ThreadPersistenceRef = { ...ref, threadId };
  try {
    const raw = await readFile(threadFile(persistence), "utf8");
    const parsed = JSON.parse(raw) as ThreadContext;
    // 过滤掉未注册 type 的 windows (Round 7 移除 issue 后, 历史 thread.json 可能含 type="issue"
    // 等遗留 entries; 不过滤会让 getWindowTypeDefinition 抛 INTERNAL_ERROR 阻塞所有依赖 thread
    // 的 API。过滤是上游 graceful skip — registry 仍 fail-loud, 但读历史 thread 时不 crash。
    // 打 console.warn 让运维知道发生了 silent drop, 符合 silent-swallow ban。)
    const rawWindows = Array.isArray(parsed.contextWindows) ? parsed.contextWindows : [];
    const known = new Set(listRegisteredWindowTypes());
    const filteredWindows = rawWindows.filter((w) => known.has(w.type));
    if (filteredWindows.length !== rawWindows.length) {
      const dropped = rawWindows.filter((w) => !known.has(w.type));
      console.warn(
        `[readThread] ${persistence.objectId}/${threadId}: dropped ${dropped.length} window(s) with unregistered types:`,
        dropped.map((w) => `${w.id}=${w.type}`).join(", "),
      );
    }
    // Round 13 迁移: command_exec form.status="executed" 已被四态机替换为 success|failed;
    // 历史数据可能仍含 "executed" 字面值。把它们迁为 "failed" (保守路径; 让 LLM 能 refine 修复),
    // 与 unregistered type 同款 silent-swallow ban: warn 但不抛。
    const contextWindows = filteredWindows.map((w) => {
      if (w.type === "command_exec" && (w as { status?: string }).status === "executed") {
        console.warn(
          `[readThread] ${persistence.objectId}/${threadId}: migrated form ${w.id} status "executed" → "failed" (Round 13)`,
        );
        return { ...w, status: "failed" as const };
      }
      return w;
    });
    const restored: ThreadContext = {
      ...parsed,
      contextWindows,
      persistence,
    };
    // 兜底：缺 creator window 时补一个（spec § 初始 creator 对话 window）
    initContextWindows(restored, {
      creatorThreadId: restored.creatorThreadId,
      initialTaskTitle: `thread ${restored.id}`,
    });
    return restored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
