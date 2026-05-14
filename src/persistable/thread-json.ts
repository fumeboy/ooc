import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { threadDir, toJson, type FlowObjectRef, type ThreadPersistenceRef } from "./common";
import type { ThreadContext } from "../thinkable/context";
import type { CommandExecWindow, ContextWindow } from "../executable/windows/types";
import { initContextWindows } from "../executable/windows/init";

/** 单个线程的 `thread.json` 绝对路径。 */
export function threadFile(ref: ThreadPersistenceRef): string {
  return join(threadDir(ref), "thread.json");
}

/** 把线程上下文持久化到 `thread.json`；线程未携带 persistence ref 时静默跳过。 */
export async function writeThread(thread: ThreadContext): Promise<void> {
  if (!thread.persistence) return;
  await mkdir(threadDir(thread.persistence), { recursive: true });
  await writeFile(threadFile(thread.persistence), toJson(thread), "utf8");
}

/**
 * 旧 thread.json 兼容形态 — 仅用于反序列化。
 *
 * Step 1 重构（spec 2026-05-14）以前的 ThreadContext 含这些字段，反序列化时按规则转换：
 * - activeForms → contextWindows（type=command_exec）
 * - windows / pinnedKnowledge → 丢弃并 console.warn（Step 2 file_window / knowledge_window 才回归）
 * - waitingType / awaitingChildren → 丢弃；status=waiting 由新 inbox 唤醒规则处理
 */
type LegacyThreadJson = ThreadContext & {
  activeForms?: Array<{
    formId: string;
    command: string;
    description: string;
    accumulatedArgs?: Record<string, unknown>;
    commandPaths?: string[];
    loadedKnowledgePaths?: string[];
    commandKnowledgePaths?: string[];
    status?: "open" | "executing" | "executed";
    result?: string;
    createdAt?: number;
  }>;
  windows?: Record<string, unknown>;
  pinnedKnowledge?: string[];
  waitingType?: unknown;
  awaitingChildren?: unknown;
};

const ROOT_WINDOW_PARENT_ID = "root";

/** 把单个旧 ActiveForm 数据转成 CommandExecWindow。 */
function legacyFormToCommandExecWindow(form: NonNullable<LegacyThreadJson["activeForms"]>[number]): CommandExecWindow {
  return {
    id: form.formId,
    type: "command_exec",
    parentWindowId: ROOT_WINDOW_PARENT_ID,
    title: form.description || form.command,
    status: form.status ?? "open",
    createdAt: form.createdAt ?? Date.now(),
    command: form.command,
    description: form.description,
    accumulatedArgs: form.accumulatedArgs ?? {},
    commandPaths: form.commandPaths ?? [form.command],
    loadedKnowledgePaths: form.loadedKnowledgePaths ?? [],
    commandKnowledgePaths: form.commandKnowledgePaths,
    result: form.result,
  };
}

/** 把任意旧形态 thread.json 升级为新 ThreadContext。 */
function migrateLegacyThread(legacy: LegacyThreadJson): ThreadContext {
  const migrated: ThreadContext = {
    id: legacy.id,
    status: legacy.status,
    events: legacy.events ?? [],
    parentThreadId: legacy.parentThreadId,
    creatorThreadId: legacy.creatorThreadId,
    childThreadIds: legacy.childThreadIds,
    childThreads: legacy.childThreads,
    inbox: legacy.inbox,
    outbox: legacy.outbox,
    plan: legacy.plan,
    contextWindows: Array.isArray(legacy.contextWindows) ? legacy.contextWindows : [],
    threadLocalData: legacy.threadLocalData,
    endReason: legacy.endReason,
    endSummary: legacy.endSummary,
    lastExecutedAt: legacy.lastExecutedAt,
    inboxSnapshotAtWait: legacy.inboxSnapshotAtWait,
    persistence: legacy.persistence,
  };

  // activeForms → command_exec windows
  if (Array.isArray(legacy.activeForms) && legacy.activeForms.length > 0) {
    const migratedForms: ContextWindow[] = legacy.activeForms.map(legacyFormToCommandExecWindow);
    migrated.contextWindows = [...migrated.contextWindows, ...migratedForms];
  }

  // file/knowledge window 与 pinnedKnowledge 在 Step 1 不回归
  if (legacy.windows && Object.keys(legacy.windows).length > 0) {
    console.warn(
      `[migrate] thread ${legacy.id} 含旧 windows 字段（${Object.keys(legacy.windows).join(",")}），Step 1 暂不支持 file/knowledge window，已丢弃；Step 2 回归后可重新打开。`,
    );
  }
  if (Array.isArray(legacy.pinnedKnowledge) && legacy.pinnedKnowledge.length > 0) {
    console.warn(
      `[migrate] thread ${legacy.id} 含旧 pinnedKnowledge 字段（${legacy.pinnedKnowledge.length} 项），Step 1 暂不支持显式 pin，已丢弃；自动激活仍按 commandPaths 工作。`,
    );
  }
  if (legacy.waitingType !== undefined || legacy.awaitingChildren !== undefined) {
    // 静默丢弃；新模型下 status=waiting 即等 inbox 新消息
  }

  // 兜底：如果迁移后没有 creator do_window，补一个（spec § 初始 creator 对话 window）
  initContextWindows(migrated, {
    creatorThreadId: migrated.creatorThreadId,
    initialTaskTitle: `thread ${migrated.id}`,
  });

  return migrated;
}

/** 从磁盘恢复线程上下文，并把 persistence ref 重新挂上。 */
export async function readThread(
  ref: FlowObjectRef,
  threadId: string
): Promise<ThreadContext | undefined> {
  const persistence: ThreadPersistenceRef = { ...ref, threadId };
  try {
    const raw = await readFile(threadFile(persistence), "utf8");
    const parsed = JSON.parse(raw) as LegacyThreadJson;
    const migrated = migrateLegacyThread({ ...parsed, persistence });
    return migrated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
