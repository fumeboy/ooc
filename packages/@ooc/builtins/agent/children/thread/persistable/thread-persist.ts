/**
 * thread —— **容器持久化逻辑**的标准 `save`/`load` 实现（thread builtin 自有，不属 core）。
 *
 * thread 是 builtin object：它怎么把自己的会话运行态落盘/读回是 thread 自己的逻辑——
 * thread.json（thread 自身对象数据：status/events/outbox/… strip 掉易变内存字段）+
 * thread-context.json（窗状态：元信息 + win，inline class 整窗 vs 独立对象 `_ref`）+
 * inbox（per-message 目录）+ hydrate（冷恢复重建）。core 只提供框架与 API：串行写、路径原语、
 * 默认 data.json IO（`saveObjectData`）、inbox per-message 原语、registry dispatch；本模块经标准
 * `persistable.save`/`load` 注册（不再有专属 `container` 契约），被 core 的 `writeThread`/`readThread`
 * 与 manager persist hook 用 thread 作用域 ctx（含 threadId）dispatch 调用（object-model 核心 7 +
 * persistable「core=框架+API、builtin=逻辑」边界）。
 *
 * 归属（窗持引用、对象持数据）：
 * - thread.json（thread 对象自身数据）：不含 contextWindows / inbox（各有独立权威，避免双写漂移）。
 * - thread-context.json（thread 维度的**窗状态**）：该 thread 的窗的元信息 + win；inline class 整窗、
 *   独立对象仅 `_ref`（被指对象数据各自落 data.json，不内联）。
 * - data.json（object 维度）：独立子窗自身 data，跨线程共享。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type {
  FlowObjectRef,
  ThreadPersistenceRef,
} from "@ooc/core/persistable/common.js";
import { threadDir, toJson } from "@ooc/core/persistable/common.js";
import { threadFile } from "./thread-json.js";
import {
  writeThreadContext,
  readThreadContext,
  type ThreadContextEntry,
} from "./flow-thread-context.js";
import { readRuntimeObjectData } from "@ooc/core/persistable/flow-runtime-object.js";
import { objectDir } from "@ooc/core/persistable/common.js";
import {
  saveObjectData,
  threadPersistRef,
  isTransientInstance,
} from "@ooc/core/persistable/object-data.js";
import {
  persistInboxMessages,
  readInboxMessages,
} from "./inbox-store.js";
import type { PersistableContext } from "@ooc/core/persistable/contract.js";
import {
  ROOT_WINDOW_ID,
  isNonPersistedWindow,
  type ContextWindow,
} from "@ooc/core/_shared/types/context-window.js";
import type { ThreadContext } from "@ooc/core/thinkable/context.js";
import {
  initContextWindows,
  injectPeerWindowsIfObjectThread,
  injectMemberWindowsIfObjectThread,
} from "@ooc/core/thinkable/context/init.js";
import type { ObjectRegistry } from "@ooc/core/runtime/object-registry.js";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import type { OocObjectInstance } from "@ooc/core/runtime/ooc-class.js";
import { observeWarn } from "@ooc/core/observable/log-aggregator.js";

/**
 * 把一组内存里的 contextWindow 序列化成 thread-context.json 的窗状态 entry 数组（**唯一**生成规则）。
 *   - root window 跳过
 *   - isNonPersistedWindow（volatile derived + self 门面窗）跳过——无 data.json，落 `_ref` 必报 missing
 *   - inline class（运行态自有窗）→ 整窗 inline（state 即 context）
 *   - 否则（独立对象）→ 轻量 `_ref`，hydrate 时另读 `<id>/data.json`（被指对象数据各自落，不内联）
 */
function buildEntries(
  windows: Iterable<ContextWindow>,
  registry: ObjectRegistry,
): ThreadContextEntry[] {
  const entries: ThreadContextEntry[] = [];
  for (const window of windows) {
    if (window.id === ROOT_WINDOW_ID) continue;
    if (isNonPersistedWindow(window)) continue;
    // self/member 门面窗一律不落盘（无独立 data.json、每轮 init 确定性重建，落 `_ref` 必 missing 刷屏）。
    // 旧"带 summarizedRanges 就 inline 落 self 门面窗"后门已删——events 折叠态现挂**自己视角 thread 窗**
    // （THREAD_CLASS_ID inline 类整窗落盘、folds 随之跨 reload 存活；builtin 类 hydrate 恒注册、无冷启动丢窗洞）。
    if (registry.isInlinePersisted(window.class)) {
      entries.push(window as ContextWindow);
    } else {
      entries.push({
        id: window.id,
        class: window.class,
        _ref: true,
        refObjectId: window.id,
      });
    }
  }
  return entries;
}

/**
 * 持久化前剥离 in-process 内存字段：
 * - inbox → 独立 per-message 目录（append-only 并发安全），不进 thread.json。
 * - contextWindows → thread-context.json 单独权威，不进 thread.json（避免双写漂移）。
 */
function stripVolatileForPersist(thread: ThreadContext): Omit<ThreadContext, "contextWindows"> {
  const {
    inbox: _dropInbox,
    contextWindows: _dropContextWindows,
    ...threadRest
  } = thread;
  return threadRest;
}

/**
 * 把 thread-context.json 的 entry hydrate 成内存 OocObjectInstance[]。
 * - inline class：data 随 entry inline，直接成实例。
 * - 独立对象：entry 剥了 data（在各自 data.json），另读合回 inst.data。
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
      const dataRef: FlowObjectRef = {
        baseDir: persistence.baseDir,
        sessionId: persistence.sessionId,
        objectId: env.id,
      };
      const loadFn = registry.resolvePersistable(env.class)?.load;
      if (loadFn) {
        // 独立子窗 data.json 读不到/损坏 → data 留 undefined（下方填 {}），hydrate 不因单个
        // 子窗读失败而整体中断（fail-soft，缺数据由渲染层处理）。
        data = await loadFn({
          baseDir: dataRef.baseDir,
          objectId: dataRef.objectId,
          sessionId: dataRef.sessionId,
          dir: objectDir(dataRef),
        }).catch(() => undefined); // intentional: 子窗 data 读失败回落 undefined，不中断 hydrate
      } else {
        // intentional: 同上——data.json 读失败回落 undefined，不中断整条 thread hydrate。
        data = await readRuntimeObjectData(dataRef).catch(() => undefined);
      }
    }
    // object/context-window 拆分 P1：非 inline（原 `_ref` entry）重建的独立对象窗自描述为引用——
    // 设 objectRef 让 referencedObjectId 直接解析（refObjectId 优先、回落 env.id；现 1:1）。
    // inline 整窗（state 即 context）不设，object 仍内联在 data。
    const isInline = registry.isInlinePersisted(env.class);
    const refObjectId =
      (entry as { refObjectId?: string }).refObjectId ?? env.id;
    instances.push({
      id: env.id,
      class: env.class,
      parentObjectId: env.parentObjectId,
      title: env.title ?? env.id,
      status: env.status ?? "open",
      createdAt: env.createdAt ?? Date.now(),
      data: data ?? {},
      win: env.win,
      ...(isInline ? {} : { objectRef: { objectId: refObjectId, class: env.class } }),
    });
  }
  return instances;
}

/**
 * 标准 `persistable.save` —— 把整个 thread（thread.json + thread-context.json + 各独立子窗
 * data.json + inbox）落盘。thread（ctx 的 data）自带 persistence ref（权威定位）；未携带则静默跳过。
 */
export async function saveThread(_ctx: PersistableContext, thread: ThreadContext): Promise<void> {
  if (!thread.persistence) return;
  const registry = builtinRegistry;
  await mkdir(threadDir(thread.persistence), { recursive: true });
  // inbox → 独立 per-message 目录（append-only，并发安全），再从 thread.json strip 掉。
  await persistInboxMessages(thread.persistence, thread.inbox);
  // contextWindows（OocObjectInstance[]）→ thread-context.json（窗状态：元信息 + win + 引用）+
  // 各独立对象 data 落各自 data.json（不内联）。
  const tref = threadPersistRef(thread);
  if (tref) {
    await writeThreadContext(tref, buildEntries(thread.contextWindows ?? [], registry));
  }
  for (const inst of thread.contextWindows ?? []) {
    if (isTransientInstance(inst)) continue;
    await saveObjectData(registry, thread, inst);
  }
  // thread.json = thread 对象自身数据（strip 掉 contextWindows / inbox / 内存字段）。
  await writeFile(threadFile(thread.persistence), toJson(stripVolatileForPersist(thread)), "utf8");
}

/**
 * 标准 `persistable.load` —— 从盘 hydrate 一个 thread，并把 persistence ref 重新挂上。
 * ctx 携带 thread 二级寻址（baseDir/sessionId/objectId + threadId）；缺 threadId 视为不可定位 → undefined。
 */
export async function loadThread(ctx: PersistableContext): Promise<ThreadContext | undefined> {
  if (!ctx.threadId) return undefined;
  const registry = builtinRegistry;
  const persistence: ThreadPersistenceRef = {
    baseDir: ctx.baseDir,
    sessionId: ctx.sessionId ?? "",
    objectId: ctx.objectId,
    threadId: ctx.threadId,
  };
  let raw: string;
  try {
    raw = await readFile(threadFile(persistence), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const parsed = JSON.parse(raw) as ThreadContext;
  // feat 分支绑定随 thread.json 持久化在 parsed.persistence；ctx 只含
  // {baseDir,sessionId,objectId,threadId}，恢复时把绑定从磁盘读回挂上。
  if (parsed.persistence?.stonesBranch) {
    persistence.stonesBranch = parsed.persistence.stonesBranch;
    if (parsed.persistence.sedimentIntent) {
      persistence.sedimentIntent = parsed.persistence.sedimentIntent;
    }
  }
  const restored: ThreadContext = {
    ...parsed,
    contextWindows: [],
    persistence,
  };
  // inbox 以独立 per-message 目录为权威，merge 历史 thread.json.inbox（平滑迁移：按 id 去重并入）。
  const dirInbox = await readInboxMessages(persistence);
  const seenInbox = new Set(dirInbox.map((m) => m.id));
  restored.inbox = [
    ...dirInbox,
    ...((parsed.inbox ?? []).filter((m) => !seenInbox.has(m.id))),
  ];
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
}
