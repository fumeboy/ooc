import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { threadDir, objectDir, toJson, type FlowObjectRef, type ThreadPersistenceRef } from "./common";
import type { ThreadContext } from "../thinkable/context";
import {
  initContextWindows,
  injectPeerWindowsIfObjectThread,
  injectMemberWindowsIfObjectThread,
} from "@ooc/core/thinkable/context/init.js";
import type { ObjectRegistry } from "../runtime/object-registry.js";
import { builtinRegistry } from "../runtime/object-registry.js";
import {
  readThreadContext,
  type ThreadContextEntry,
} from "./flow-thread-context";
import { readRuntimeObjectState } from "./flow-runtime-object";
import type { OocObjectInstance } from "../runtime/ooc-class.js";
import { persistInboxMessages, readInboxMessages } from "./inbox-store";
import { observeWarn } from "../observable/log-aggregator";

/**
 * thread.json 的最小读写（Wave 4 对象模型）。
 *
 * `thread.contextWindows` 现在是 `OocObjectInstance[]`（信封 + data + win 分离）。落盘分两处：
 * - thread.json：thread 元数据（不含 contextWindows——避免双写漂移）。
 * - thread-context.json：实例信封 + win（标准权威；独立 object 的 data 在各自 state.json）。
 *
 * 读回时把 thread-context.json 的 entry hydrate 成 OocObjectInstance：独立 object envelope
 * 另读 `<id>/state.json` 合回 data；builtin-feature inline entry 整窗即实例。
 */

/** 单个线程的 `thread.json` 绝对路径。 */
export function threadFile(ref: ThreadPersistenceRef): string {
  return join(threadDir(ref), "thread.json");
}

/**
 * 持久化前剥离 in-process 内存字段。
 * - inbox → 独立 per-message 目录（inbox-store，append-only 并发安全），不进 thread.json。
 * - contextWindows → thread-context.json 单独权威，不进 thread.json（避免双写漂移）。
 */
function stripVolatileForPersist(thread: ThreadContext): Omit<ThreadContext, "contextWindows"> {
  const {
    intentCache: _dropIntentCache,
    inbox: _dropInbox,
    contextWindows: _dropContextWindows,
    ...threadRest
  } = thread;
  return threadRest;
}

/**
 * 把线程上下文持久化到 `thread.json` + `thread-context.json`；线程未携带 persistence ref
 * 时静默跳过。
 *
 * 单点刷：writeThread 是非 WindowManager 路径（delivery / scheduler / service 等直接改
 * thread.contextWindows）的唯一持久化入口。它复用 WindowPersistence 的 snapshot 规则刷
 * thread-context.json + 各独立 object 的 data state.json，与 WindowManager hooks 一致。
 */
export async function writeThread(thread: ThreadContext): Promise<void> {
  if (!thread.persistence) return;
  await mkdir(threadDir(thread.persistence), { recursive: true });
  // inbox → 独立 per-message 目录（append-only，并发安全），再从 thread.json strip 掉。
  await persistInboxMessages(thread.persistence, thread.inbox);
  // contextWindows（OocObjectInstance[]）→ thread-context.json（信封+win）+ 各 data state.json。
  await persistContextWindows(thread);
  const sanitized = stripVolatileForPersist(thread);
  await writeFile(threadFile(thread.persistence), toJson(sanitized), "utf8");
}

/**
 * 把 thread.contextWindows（OocObjectInstance[]）落盘：信封+win → thread-context.json，
 * 独立 object 的 data → 各自 state.json。复用 WindowPersistence（live Map 引用），保证与
 * WindowManager hooks 同一份序列化规则、不产生冲突写。
 */
async function persistContextWindows(thread: ThreadContext): Promise<void> {
  // 动态 import 防 persistable ↔ executable 循环。
  const { WindowPersistence } = await import(
    "@ooc/core/persistable/window-persistence.js"
  );
  const instances = new Map<string, OocObjectInstance>();
  for (const inst of thread.contextWindows ?? []) instances.set(inst.id, inst);
  const wp = new WindowPersistence(builtinRegistry, instances);
  await wp.writeThreadContextSnapshot(thread);
  for (const inst of instances.values()) {
    await wp.saveData(thread, inst);
  }
}

/** 从磁盘恢复线程上下文，并把 persistence ref 重新挂上。 */
export async function readThread(
  ref: FlowObjectRef,
  threadId: string,
  registry: ObjectRegistry = builtinRegistry,
): Promise<ThreadContext | undefined> {
  const persistence: ThreadPersistenceRef = { ...ref, threadId };
  try {
    const raw = await readFile(threadFile(persistence), "utf8");
    const parsed = JSON.parse(raw) as ThreadContext;
    // feat 分支绑定（reflectable 沉淀直接编辑路径）随 thread.json 持久化在 parsed.persistence；
    // caller 传的 ref 只含 {baseDir,sessionId,objectId}，恢复时把绑定从磁盘读回挂上。
    if (parsed.persistence?.stonesBranch) {
      persistence.stonesBranch = parsed.persistence.stonesBranch;
      if (parsed.persistence.sedimentIntent) {
        persistence.sedimentIntent = parsed.persistence.sedimentIntent;
      }
    }
    // contextWindows 从 thread-context.json hydrate（thread.json 不再携带）。
    const restored: ThreadContext = {
      ...parsed,
      contextWindows: [],
      persistence,
    };
    // inbox 从独立 per-message 目录读（append-only 并发安全），以目录为权威，merge 历史
    // thread.json.inbox（平滑迁移：按 id 去重并入）。
    const dirInbox = await readInboxMessages(persistence);
    const seenInbox = new Set(dirInbox.map((m) => m.id));
    restored.inbox = [
      ...dirInbox,
      ...((parsed.inbox ?? []).filter((m) => !seenInbox.has(m.id))),
    ];
    // hydrate contextWindows = OocObjectInstance[]。
    restored.contextWindows = await hydrateContextWindows(persistence, registry);
    // 兜底注入：缺 creator window 时补一个（初始 creator 对话 window）。
    initContextWindows(restored, {
      creatorThreadId: restored.creatorThreadId,
      initialTaskTitle: `thread ${restored.id}`,
    });
    // peer / member window 注入：冷恢复时补齐 sibling + children + 声明成员。
    await injectPeerWindowsIfObjectThread(restored);
    await injectMemberWindowsIfObjectThread(restored);
    return restored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * 把 thread-context.json 的 entry hydrate 成内存 OocObjectInstance[]。
 *
 * 每条 entry 是一个实例信封（id/class/title/status/createdAt/parentObjectId + 可选 win）：
 * - builtin-feature class：data 随 entry inline，直接成实例。
 * - 独立 object：entry 剥了 data（在各自 state.json），这里另读 state.json 合回 inst.data。
 * 未注册 class 的实例丢弃（打 warn）。
 */
async function hydrateContextWindows(
  persistence: ThreadPersistenceRef,
  registry: ObjectRegistry,
): Promise<OocObjectInstance[]> {
  let file: Awaited<ReturnType<typeof readThreadContext>>;
  try {
    file = await readThreadContext(persistence);
  } catch (e) {
    observeWarn(
      "readThread.thread-context.read-failed",
      `[readThread] 读取 thread-context.json 失败（不阻塞，回落空 context）: ${(e as Error).message}`,
    );
    return [];
  }
  if (!file || !Array.isArray(file.contextWindows) || file.contextWindows.length === 0) {
    return [];
  }

  const instances: OocObjectInstance[] = [];
  for (const entry of file.contextWindows as ThreadContextEntry[]) {
    if (!entry || typeof entry !== "object") continue;
    const env = entry as Partial<OocObjectInstance> & { id?: string; class?: string };
    if (typeof env.id !== "string" || typeof env.class !== "string") continue;
    if (!registry.has(env.class)) {
      observeWarn(
        "readThread.thread-context.unregistered",
        `[readThread] thread-context.json: dropped instance ${env.id} with unregistered class ${env.class}`,
      );
      continue;
    }
    let data: unknown = (env as { data?: unknown }).data;
    if (data === undefined && !registry.isInlinePersisted(env.class)) {
      // 独立 object：entry 剥了 data，另读 state.json。
      const stateRef: FlowObjectRef = {
        baseDir: persistence.baseDir,
        sessionId: persistence.sessionId,
        objectId: env.id,
      };
      const loadFn = registry.resolvePersistable(env.class)?.load;
      if (loadFn) {
        data = await loadFn({
          baseDir: stateRef.baseDir,
          objectId: stateRef.objectId,
          sessionId: stateRef.sessionId,
          dir: objectDir(stateRef),
        }).catch(() => undefined);
      } else {
        const rawState = await readRuntimeObjectState(stateRef).catch(() => undefined);
        data = rawState ? (rawState as { data?: unknown }).data ?? rawState : undefined;
      }
    }
    instances.push({
      id: env.id,
      class: env.class,
      parentObjectId: env.parentObjectId,
      title: env.title ?? env.id,
      status: env.status ?? "open",
      createdAt: env.createdAt ?? Date.now(),
      data: data ?? {},
      win: env.win,
    });
  }
  return instances;
}
