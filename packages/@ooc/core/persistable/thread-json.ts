import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { threadDir, toJson, type FlowObjectRef, type ThreadPersistenceRef } from "./common";
import type { ThreadContext } from "../thinkable/context";
import { initContextWindows, injectPeerWindowsIfObjectThread } from "../executable/windows/_shared/init";
import type { ObjectRegistry } from "../executable/windows/_shared/registry";
import { builtinRegistry } from "../executable/windows/index.js";
import { readContextRegistry } from "./flow-context-registry";
import { readRuntimeObjectState } from "./flow-runtime-object";
import {
  buildThreadContextEntries,
  readThreadContext,
  writeThreadContext,
  type ThreadContextEntry,
} from "./flow-thread-context";
import type { ContextWindow } from "../executable/windows/_shared/types";
import { persistInboxMessages, readInboxMessages } from "./inbox-store";
import { observeWarn } from "../observable/log-aggregator";

/**
 * thread.json 的最小读写。
 *
 * 移除早期的 LegacyThreadJson 兼容层。
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
 * - inbox / intentCache → 独立目录或纯内存，不进 thread.json。
 * - **contextWindows 字段已退役**：thread-context.json 是
 *   唯一完整权威，thread.json 不再携带 contextWindows。避免两文件双写漂移，
 *   也删除了掩盖不同步 bug 的 hydrate legacy fallback。
 *
 * note: ProcessEvent._foldedBy 等线程内字段仍随 thread.json 持久化（thread.json
 *   仍是 thread 元数据的权威；只有 contextWindows 这一个字段被迁出）。
 */
function stripVolatileForPersist(thread: ThreadContext): Omit<ThreadContext, "contextWindows"> {
  // inbox 落独立 per-message 目录（inbox-store，append-only 并发安全），不进 thread.json——
  // 否则 worker 的 stale in-memory inbox 整体覆盖会丢并发回报（collaborable 竞态根因）。
  // contextWindows 退役 → 从持久化对象删除该字段，由 thread-context.json 单独权威落盘。
  const {
    intentCache: _dropIntentCache,
    inbox: _dropInbox,
    contextWindows: _dropContextWindows,
    ...threadRest
  } = thread;
  return threadRest;
}

/**
 * 把线程上下文持久化到 `thread.json`；线程未携带 persistence ref 时静默跳过。
 *
 * 单点刷：writeThread 是**唯一**持久化入口，因此让它单点刷
 * thread-context.json，自动覆盖所有写路径——包括绕过 WindowManager 直接改
 * thread.contextWindows 的路径（delivery / thinkloop reconcilePeerWindows /
 * scheduler / service seedSession·addUserTalkWindow / worker）。entries 用与
 * WindowManager.writeThreadContextSnapshot 同一份 buildThreadContextEntries 生成，
 * 单一来源、不产生冲突写。
 */
export async function writeThread(thread: ThreadContext): Promise<void> {
  if (!thread.persistence) return;
  await mkdir(threadDir(thread.persistence), { recursive: true });
  // inbox → 独立 per-message 目录（append-only，并发安全），再从 thread.json strip 掉。
  await persistInboxMessages(thread.persistence, thread.inbox);
  // contextWindows → 独立 thread-context.json（唯一完整权威，含 builtin inline + flow ref）。
  const entries = buildThreadContextEntries(thread.contextWindows, builtinRegistry);
  await writeThreadContext(thread.persistence, entries);
  const sanitized = stripVolatileForPersist(thread);
  await writeFile(threadFile(thread.persistence), toJson(sanitized), "utf8");
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
    // feat 分支绑定（reflectable 沉淀直接编辑路径）随 thread.json 持久化在
    // parsed.persistence；caller 传的 ref 只含 {baseDir,sessionId,objectId}，恢复时把绑定
    // 从磁盘读回挂上，使其跨 exec tick 存活（缺省即不挂，行为不变）。
    if (parsed.persistence?.stonesBranch) {
      persistence.stonesBranch = parsed.persistence.stonesBranch;
      if (parsed.persistence.sedimentIntent) {
        persistence.sedimentIntent = parsed.persistence.sedimentIntent;
      }
    }
    // contextWindows 退役：thread.json 不再携带 contextWindows——它由独立的
    // thread-context.json 单独权威落盘。这里把 contextWindows 起始为空数组，
    // 完全交给下方 thread-context.json hydrate + init 注入填充；不再以
    // thread.json.contextWindows 为来源（旧数据若仍含该字段，一律忽略）。
    const contextWindows: ContextWindow[] = [];
    const restored: ThreadContext = {
      ...parsed,
      contextWindows,
      persistence,
    };
    // inbox 从独立 per-message 目录读（append-only 并发安全存储，inbox-store）；以目录为权威，
    // merge 历史 thread.json.inbox（平滑迁移：旧数据仍含 inbox 字段时按 id 去重并入，
    // 下次 writeThread 会把它落进目录、并从 thread.json strip 掉）。
    const dirInbox = await readInboxMessages(persistence);
    const seenInbox = new Set(dirInbox.map((m) => m.id));
    restored.inbox = [
      ...dirInbox,
      ...((parsed.inbox ?? []).filter((m) => !seenInbox.has(m.id))),
    ];
    // 新读路径 —— `<oid>/threads/<tid>/thread-context.json`
    // 优先级：thread-context.json (权威) > legacy contextRegistry
    //         > thread.contextWindows[] (legacy)
    //
    // thread-context.json 的 entry 形态：
    //   - inline ContextWindow (builtin feature: talk/do/todo/method_exec)
    //   - { id, type, _ref: true, refObjectId } —— 独立 flow object 的轻量 ref，
    //     需要去 `<refObjectId>/state.json` 取自身字段。
    //
    // 命中后：构造 in-memory contextWindows 数组，覆盖 thread.contextWindows。
    // 命中失败 / 不存在 → 回落到下面的 contextRegistry 老逻辑，保持向后兼容。
    let hydratedFromThreadContext = false;
    try {
      const threadCtx = await readThreadContext(persistence);
      // writeThread 现在恒写 thread-context.json（含空数组）。**非空**才视为权威；
      // 空 thread-context.json 视同「无完整 context」，回落到 context.json registry
      // / init 注入（保留 registry 路径可达性）。
      if (
        threadCtx &&
        Array.isArray(threadCtx.contextWindows) &&
        threadCtx.contextWindows.length > 0
      ) {
        const knownTypes = new Set(registry.listRegisteredObjectTypes());
        const merged: ContextWindow[] = [];
        for (const entry of threadCtx.contextWindows as ThreadContextEntry[]) {
          if (!entry || typeof entry !== "object") continue;
          if ("_ref" in entry && (entry as { _ref?: unknown })._ref === true) {
            // ref entry → 读 `<refObjectId>/state.json`
            const refObjectId = (entry as { refObjectId?: string }).refObjectId
              ?? (entry as { id?: string }).id;
            if (!refObjectId) continue;
            const win = await readRuntimeObjectState({
              baseDir: ref.baseDir,
              sessionId: ref.sessionId,
              objectId: refObjectId,
            });
            if (!win) {
              observeWarn(
                "readThread.thread-context.missing-object",
                `[readThread] thread-context.json references missing object ${refObjectId} (state.json absent), skipping`,
              );
              continue;
            }
            if (!knownTypes.has(win.class) && win.class !== persistence.objectId) {
              observeWarn(
                "readThread.thread-context.unregistered-type",
                `[readThread] thread-context.json: dropped object ${win.id} with unregistered type ${win.class}`,
              );
              continue;
            }
            merged.push(win);
          } else {
            // inline ContextWindow（builtin feature）
            const win = entry as ContextWindow;
            if (!knownTypes.has(win.class) && win.class !== persistence.objectId) {
              observeWarn(
                "readThread.thread-context.unregistered-inline",
                `[readThread] thread-context.json: dropped inline window ${win.id} with unregistered type ${win.class}`,
              );
              continue;
            }
            // Resilience: 若一个 builtin feature 类型在磁盘上意外存在 state.json
            //   （旧布局残留），打 warn 不阻塞 —— state ≠ context 不变量靠新写盘端守门，
            //   读端只警告。
            if (registry.isBuiltinFeatureType(win.class)) {
              // 没有强校验副作用；保留 warn hook 以便后续 cleanup 时定位。
              // 注意：不主动 readRuntimeObjectState 探测（噪音太多）。
            }
            merged.push(win);
          }
        }
        // 退役：thread-context.json 是唯一完整权威——不再把 thread.json.contextWindows
        // 多余 window 补回（旧 fallback 掩盖了绕过 WindowManager 的写路径与 thread-context.json
        // 不同步的 bug；writeThread 单点刷已根治不同步，fallback 删除）。
        restored.contextWindows = merged;
        hydratedFromThreadContext = true;
      }
    } catch (e) {
      observeWarn(
        "readThread.thread-context.read-failed",
        `[readThread] 读取 thread-context.json 失败（不阻塞，将回落到 contextRegistry）: ${(e as Error).message}`,
      );
    }
    // 从 thread context.json registry 读（保留）。
    // 嵌套 context/<id>/window.json 路径已下线。
    // thread-context.json 命中后跳过此分支（避免双源冲突）。
    // 删除 thread.json.contextWindows legacy fallback（该字段已退役，恒为空）。
    if (!hydratedFromThreadContext) try {
      const ctxRegistry = await readContextRegistry(persistence);
      if (ctxRegistry.members.length > 0) {
        const knownTypes = new Set(registry.listRegisteredObjectTypes());
        const sorted = [...ctxRegistry.members].sort((a, b) => {
          const oa = a.params.order ?? Number.MAX_SAFE_INTEGER;
          const ob = b.params.order ?? Number.MAX_SAFE_INTEGER;
          return oa - ob;
        });
        const merged: typeof contextWindows = [];
        for (const member of sorted) {
          const win = await readRuntimeObjectState({
            baseDir: ref.baseDir,
            sessionId: ref.sessionId,
            objectId: member.objectId,
          });
          if (!win) {
            observeWarn(
              "readThread.registry.missing-object",
              `[readThread] registry references missing object ${member.objectId} (state.json absent), skipping`,
            );
            continue;
          }
          if (!knownTypes.has(win.class)) {
            observeWarn(
              "readThread.registry.unregistered-type",
              `[readThread] registry: dropped object ${win.id} with unregistered type ${win.class}`,
            );
            continue;
          }
          // 把 registry params 投影回 in-memory ContextWindow
          const projected = { ...win } as typeof win;
          if (member.params.compressLevel !== undefined && member.params.compressLevel !== 0) {
            (projected as { compressLevel?: number }).compressLevel = member.params.compressLevel;
          }
          if (member.params.parentObjectId !== undefined) {
            (projected as { parentWindowId?: string }).parentWindowId = member.params.parentObjectId;
          }
          merged.push(projected);
        }
        restored.contextWindows = merged;
      }
    } catch (e) {
      console.warn(
        `[readThread] 读取 context.json registry 失败（不阻塞）: ${(e as Error).message}`,
      );
    }
    // 兜底：缺 creator window 时补一个（初始 creator 对话 window）
    initContextWindows(restored, {
      creatorThreadId: restored.creatorThreadId,
      initialTaskTitle: `thread ${restored.id}`,
    });
    // peer window 注入：冷恢复时也补齐 sibling + children
    await injectPeerWindowsIfObjectThread(restored);
    return restored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
