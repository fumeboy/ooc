import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { threadDir, toJson, type FlowObjectRef, type ThreadPersistenceRef } from "./common";
import type { ThreadContext } from "../thinkable/context";
import { initContextWindows, injectPeerWindowsIfObjectThread } from "../executable/windows/_shared/init";
import type { ObjectRegistry } from "../executable/windows/_shared/registry";
import { builtinRegistry } from "../executable/windows/index.js";
import { readContextRegistry } from "./flow-context-registry";
import { readRuntimeObjectState } from "./flow-runtime-object";
import { readThreadContext, type ThreadContextEntry } from "./flow-thread-context";
import type { ContextWindow } from "../executable/windows/_shared/types";
import { isVolatileDerivedWindow } from "../executable/windows/_shared/types";
import { persistInboxMessages, readInboxMessages } from "./inbox-store";
import { observeWarn } from "../observable/log-aggregator";

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
 *
 * P0f note: ProcessEvent._foldedBy 同样下划线前缀但**保留**进 thread.json
 *   (fold 状态的唯一锚点,strip 掉会导致 reload 后折叠丢失)。
 *
 * 历史: 2026-05-26 移除 IssueWindow lastSeenCommentId / lastNotifiedAt 的 strip 逻辑
 *   (issue 看板已整体移除)。
 */
function stripVolatileForPersist(thread: ThreadContext): ThreadContext {
  // inbox 落独立 per-message 目录（inbox-store，append-only 并发安全），不进 thread.json——
  // 否则 worker 的 stale in-memory inbox 整体覆盖会丢并发回报（collaborable 竞态根因）。
  const { intentCache: _dropIntentCache, inbox: _dropInbox, ...threadRest } = thread;
  return {
    ...threadRest,
    // volatile derived window（form-bound guidance）不落 thread.json：每轮 enrichment 重算，
    // 持久化只会在 reload 时被当 unregistered type drop + 刷屏。
    contextWindows: thread.contextWindows
      .filter((window) => !isVolatileDerivedWindow(window))
      .map((window) => {
      let next = window;
      if (!next.compressLevel) {
        const { compressLevel: _drop, ...rest } = next;
        next = rest as typeof next;
      }
      // P6.§7: effectiveVisibleType 是每轮 enrichment 产物，不持久化。
      if (next.effectiveVisibleType !== undefined) {
        const { effectiveVisibleType: _drop, ...rest } = next;
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
  // inbox → 独立 per-message 目录（append-only，并发安全），再从 thread.json strip 掉。
  await persistInboxMessages(thread.persistence, thread.inbox);
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
    // 过滤掉未注册 type 的 windows (Round 7 移除 issue 后, 历史 thread.json 可能含 type="issue"
    // 等遗留 entries; 不过滤会让 getObjectDefinition 抛 INTERNAL_ERROR 阻塞所有依赖 thread
    // 的 API。过滤是上游 graceful skip — registry 仍 fail-loud, 但读历史 thread 时不 crash。
    // 打 console.warn 让运维知道发生了 silent drop, 符合 silent-swallow ban。)
    const rawWindows = Array.isArray(parsed.contextWindows) ? parsed.contextWindows : [];
    const known = new Set(registry.listRegisteredObjectTypes());
    // ooc-6: self window 的 type === objectId（stone-backed type），它会在 synthesizer
    // 的 ensureSelfObjectTypeRegistered 阶段才注册到 registry——读时还没注册。
    // 所以放行 type === self objectId 的 window，避免被这里的 filter 误丢。
    const selfTypeAllowance = persistence.objectId;
    const filteredWindows = rawWindows.filter(
      (w) => known.has(w.type) || w.type === selfTypeAllowance,
    );
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
    //
    // Phase H 迁移: "command_exec" type string 已统一为 "method_exec"。
    const contextWindows = filteredWindows.map((w) => {
      let migrated: any = w;
      // Phase H: type "command_exec" → "method_exec"
      if (migrated.type === "command_exec") {
        migrated = { ...migrated, type: "method_exec" as const };
      }
      // Round 13: status "executed" → "failed"
      if (migrated.type === "method_exec" && (migrated as { status?: string }).status === "executed") {
        console.warn(
          `[readThread] ${persistence.objectId}/${threadId}: migrated form ${migrated.id} status "executed" → "failed" (Round 13)`,
        );
        migrated = { ...migrated, status: "failed" as const };
      }
      return migrated;
    });
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
    // 2026-06-02 ooc-6 P6.§6: 新读路径 —— `<oid>/threads/<tid>/thread-context.json`
    // 优先级：thread-context.json (P6.§6 权威) > legacy contextRegistry (P5'.1)
    //         > thread.contextWindows[] (pre-P5'.1 legacy)
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
      if (threadCtx && Array.isArray(threadCtx.contextWindows)) {
        const knownTypes = new Set(registry.listRegisteredObjectTypes());
        const merged: ContextWindow[] = [];
        const seenIds = new Set<string>();
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
            if (!knownTypes.has(win.type) && win.type !== persistence.objectId) {
              observeWarn(
                "readThread.thread-context.unregistered-type",
                `[readThread] thread-context.json: dropped object ${win.id} with unregistered type ${win.type}`,
              );
              continue;
            }
            merged.push(win);
            seenIds.add(win.id);
          } else {
            // inline ContextWindow（builtin feature）
            const win = entry as ContextWindow;
            if (!knownTypes.has(win.type) && win.type !== persistence.objectId) {
              observeWarn(
                "readThread.thread-context.unregistered-inline",
                `[readThread] thread-context.json: dropped inline window ${win.id} with unregistered type ${win.type}`,
              );
              continue;
            }
            // Resilience: 若一个 builtin feature 类型在磁盘上意外存在 state.json
            //   （旧布局残留），打 warn 不阻塞 —— state ≠ context 不变量靠新写盘端守门，
            //   读端只警告。
            if (registry.isBuiltinFeatureType(win.type)) {
              // 没有强校验副作用；保留 warn hook 以便后续 §10 cleanup 时定位。
              // 注意：不主动 readRuntimeObjectState 探测（噪音太多）。
            }
            merged.push(win);
            seenIds.add(win.id);
          }
        }
        // legacy fallback：thread.contextWindows[] 中尚未被 thread-context.json 覆盖的
        for (const win of contextWindows) {
          if (!seenIds.has(win.id)) merged.push(win);
        }
        restored.contextWindows = merged;
        hydratedFromThreadContext = true;
      }
    } catch (e) {
      observeWarn(
        "readThread.thread-context.read-failed",
        `[readThread] 读取 thread-context.json 失败（不阻塞，将回落到 contextRegistry）: ${(e as Error).message}`,
      );
    }
    // 2026-06-02 ooc-6 Phase 5'.2/.3: 从 thread context.json registry 读
    // 顺序：registry (权威) > thread.contextWindows[] (legacy fallback for pre-P5'.1 数据)
    // P5'.3 起：嵌套 context/<id>/window.json 路径已下线
    // P6.§6 起：thread-context.json 命中后跳过此分支（避免双源冲突）。
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
        const seenIds = new Set<string>();
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
          if (!knownTypes.has(win.type)) {
            observeWarn(
              "readThread.registry.unregistered-type",
              `[readThread] registry: dropped object ${win.id} with unregistered type ${win.type}`,
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
          seenIds.add(win.id);
        }
        // legacy fallback：把 thread.contextWindows[] 中尚未被 registry 覆盖的 window 兜底加进来
        for (const win of contextWindows) {
          if (!seenIds.has(win.id)) merged.push(win);
        }
        restored.contextWindows = merged;
      }
    } catch (e) {
      console.warn(
        `[readThread] 读取 context.json registry 失败（不阻塞）: ${(e as Error).message}`,
      );
    }
    // 兜底：缺 creator window 时补一个（spec § 初始 creator 对话 window）
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
