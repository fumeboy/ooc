/**
 * Thread 初始化 helper — 给任何新建 thread 注入指向 creator 的初始 window。
 *
 * 初始 creator 对话 window：每个 thread 启动时必有一条与创建方的恒在通道。
 *
 * Creator window 类型由 thread 本身决定，不再由调用方指定：
 * - thread.creatorObjectId === thread.persistence?.objectId（含两者都缺省）→ "do"
 *   同 object 内 fork 出的子线程；creator 是父 thread。
 *   creator window = type=do, targetThreadId=父 thread id, isCreatorWindow=true。
 * - thread.creatorObjectId 与 self 不同 → "talk"
 *   跨对象 talk 派生 callee thread；creator 是 caller object 的某个 thread。
 *   creator window = type=talk, target=caller object, targetThreadId=caller thread,
 *   isCreatorWindow=true。callee 通过该 talk_window.say 回复给 caller。
 *
 * 两种 window 共用 creatorWindowIdOf(threadId) 派生的稳定 id；幂等插入。
 */

import {
  ROOT_WINDOW_ID,
  SESSION_CREATOR_THREAD_ID,
  creatorWindowIdOf,
  type ContextWindow,
  type DoWindow,
  type TalkWindow,
} from "./types.js";
import { DEFAULT_TRANSCRIPT_VIEWPORT } from "./transcript-viewport.js";
import { isSuperSessionId } from "@ooc/core/_shared/types/constants.js";
import type { ReflectRequestWindow } from "@ooc/core/reflectable/reflect-request/types.js";
import type { ThreadContext } from "../../../thinkable/context.js";
import {
  deriveStoneFromThread,
  discoverStoneHierarchicalPeers,
  isBuiltinObjectId,
  resolveBuiltinReadDir,
  stoneDir,
  type StoneObjectRef,
} from "../../../persistable/index.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface InitContextWindowsOpts {
  /** thread 的 creator thread id；缺省 = SESSION_CREATOR_THREAD_ID（仅 root thread 适用）。 */
  creatorThreadId?: string;
  /** 初始任务标题；将作为 creator window 的 title。 */
  initialTaskTitle: string;
}

/**
 * thread 的 creator 是否=自己（同 object **且同 session**）。缺省字段视为同 object，回退 do_window。
 *
 * "同 object" 决定 do vs talk 的语义层；但 do_window 是**同 session 内进程内**的父子机制
 * （findThreadInScope 只走内存 childThreads/_parentThreadRef 树），**无法跨 session 寻址**。
 * super-alias 场景（super flow）callee 在 "super" session、caller 在 user session：objectId
 * 相同但 session 不同——若按 do 处理，callee 用 do_window.continue / end({result}) 回报
 * creator 时 findThreadInScope 永远找不到 caller（caller 在另一 session 的 thread.json 上，
 * 不在本 job 内存树里）→ 静默失败。故 cross-session 必须落 talk_window（disk-based 派送，
 * deliverTalkMessage 通过 readThread/writeThread 跨 session 寻址），与 reflectable knowledge
 * "通过 creator talk_window 回复" 的指引一致。
 *
 * creatorSessionId 由 talk-delivery 在跨 session 创建 callee 时写入；缺省回退 self session（同 session）。
 */
function isCreatorSelf(thread: ThreadContext): boolean {
  const self = thread.persistence?.objectId;
  const creator = thread.creatorObjectId;
  if (!creator) return true;
  if (!self) return true;
  if (creator !== self) return false;
  // same object：再看 session。cross-session（如 super-alias）不能走 do_window。
  const selfSession = thread.persistence?.sessionId;
  const creatorSession = thread.creatorSessionId ?? selfSession;
  return creatorSession === selfSession;
}

/**
 * user.root 是整个 session 的交互起点；它不存在 "creator"，所以也不应该有
 * 初始 creator window（do/talk 都不合适）。本函数 short-circuit 这种 thread。
 */
function isUserRootThread(thread: ThreadContext): boolean {
  return thread.persistence?.objectId === "user" && thread.id === "root";
}

/**
 * thread 是否真有 creator（不是 self-driven root）。
 *
 * 任何一处携带 creator 信息都视为有：
 * - opts.creatorThreadId 显式给（fork/talk-delivery 调用方）
 * - thread.creatorThreadId（磁盘恢复时 thread.json 里写过）
 * - thread.creatorObjectId（跨 object talk-delivery 总会设这条）
 *
 * 三者全无 → self-driven root，没有可指向的 creator，不应注入 phantom creator window。
 * wait 校验：phantom creator do_window 会被 wait 误判为合法 IO 来源，
 * 让 self-driven root 死锁——本函数从源头堵住。
 */
function hasRealCreator(thread: ThreadContext, opts: InitContextWindowsOpts): boolean {
  if (opts.creatorThreadId !== undefined) return true;
  if (thread.creatorThreadId !== undefined) return true;
  if (thread.creatorObjectId !== undefined) return true;
  return false;
}

export function initContextWindows(
  thread: ThreadContext,
  opts: InitContextWindowsOpts,
): void {
  // ooc-6: 当 thread 持有方是某 Object 时，幂等注入一个 self window
  // 单例作为该 Object 的"自我门面"。window id = object id（new design）。
  injectSelfWindowIfObjectThread(thread);

  // Note: peer Object 注入（sibling + children）是 async IO，不走同步 init。
  // 调用方在 thread 后自行 await injectPeerWindowsIfObjectThread(thread)
  // 或在每轮渲染 buildInputItems 里由 pipeline 补齐。

  if (isUserRootThread(thread)) {
    thread.contextWindows = thread.contextWindows ?? [];
    return;
  }
  if (!hasRealCreator(thread, opts)) {
    // self-driven root thread —— 没有可指向的 creator，don't inject phantom do_window
    thread.contextWindows = thread.contextWindows ?? [];
    return;
  }
  const creatorWindowId = creatorWindowIdOf(thread.id);
  const list = thread.contextWindows ?? [];
  if (list.some((w) => w.id === creatorWindowId)) {
    thread.contextWindows = list;
    return;
  }

  const creatorThreadId = opts.creatorThreadId ?? SESSION_CREATOR_THREAD_ID;
  const sameObject = isCreatorSelf(thread);

  const creatorWindow: ContextWindow = sameObject
    ? ({
        id: creatorWindowId,
        class: "do",
        parentWindowId: ROOT_WINDOW_ID,
        title: opts.initialTaskTitle,
        status: "running",
        createdAt: Date.now(),
        targetThreadId: creatorThreadId,
        isCreatorWindow: true,
        transcriptViewport: { ...DEFAULT_TRANSCRIPT_VIEWPORT },
      } satisfies DoWindow)
    : ({
        id: creatorWindowId,
        // super 反思 thread（sessionId="super"）的会话面用 reflect_request —— 同形会话窗，
        // 额外挂 new_feat_branch / create_pr_and_invite_reviewers 沉淀方法；普通跨对象 callee 用 talk。
        class: isSuperSessionId(thread.persistence?.sessionId ?? "")
          ? "reflect_request"
          : "talk",
        parentWindowId: ROOT_WINDOW_ID,
        title: opts.initialTaskTitle,
        status: "open",
        createdAt: Date.now(),
        target: thread.creatorObjectId!,
        targetThreadId: creatorThreadId,
        conversationId: creatorWindowId,
        isCreatorWindow: true,
        transcriptViewport: { ...DEFAULT_TRANSCRIPT_VIEWPORT },
      } as TalkWindow | ReflectRequestWindow);

  thread.contextWindows = [creatorWindow, ...list];
}

/**
 * ooc-6 Object Unification —— 当 thread 持有方是某 Object 时，幂等注入一个 self window
 * 单例作为该 Object 的"自我门面"。
 *
 * 新设计：
 * - window id = object id（不再经过 custom: 前缀包装）
 * - window type = object id（每个 object 注册自己的 type）
 * - 不再有 custom window wrapper
 *
 * 注入条件：
 * - thread.persistence?.objectId 存在（thread 由该 Object 持有）
 * - 该 objectId 不是 "user"（user 不是 Agent，不需要 self window）
 *
 * 位置：root 之后，creator window 之前；保证 LLM 视野中 self window 的位置稳定。
 */
function injectSelfWindowIfObjectThread(thread: ThreadContext): void {
  const objectId = thread.persistence?.objectId;
  if (!objectId || objectId === "user") return;

  const id = objectId; // window id = object id (new design)
  const list = thread.contextWindows ?? (thread.contextWindows = []);
  if (list.some((w) => w.id === id)) return;

  const selfWindow: ContextWindow = {
    id,
    class: objectId as any,
    parentWindowId: ROOT_WINDOW_ID,
    title: objectId,
    status: "open",
    createdAt: Date.now(),
    // self 门面窗每次 init 幂等重注入、无独立 state.json → 标记为不持久化，
    // 否则 thread-context.json 落死 _ref，reload 刷屏 `references missing object <id>`。
    isSelfWindow: true,
  } as ContextWindow;

  // 紧跟 root 之后；creator window 仍由后续路径插到这之前/之后均可
  thread.contextWindows = [selfWindow, ...list];
}

// ── Peer windows (sibling + level-1 children) ──────────────────────────────

/**
 * ooc-6 Peer First-Class Window —— 把同级 sibling 与直属 children peer Object
 * 作为真实可 exec 的 ContextWindow 注入 thread.contextWindows。
 *
 * 设计依据：OOC Object 的 context
 * 默认"身边"就是它的同级/子级 Object，这些 Object 应当以 first-class window
 * 形式存在，而不是仅作为渲染期派生的 observability mirror（_renderedWindows）。
 *
 * 语义：
 * - window id = peer objectId（稳定，跨 session 不变）
 * - window type = peer objectId（每个 object 注册自己的 type；PeerProcessor 每轮补注册）
 * - parentWindowId = "root"
 * - 幂等：已存在则跳过（按 id 去重）
 * - 不做 peer type 的 registry 注册——那是每轮渲染期 PeerProcessor 的职责
 *   （因为 type 注册依赖 executable/index.ts 的方法表，可能在运行期热更新）
 * - IO 失败时静默吞掉（debug log），不阻塞 thread 启动
 */
export async function injectPeerWindowsIfObjectThread(thread: ThreadContext): Promise<void> {
  const persistence = thread.persistence;
  const selfId = persistence?.objectId;
  if (!persistence || !selfId || selfId === "user") return;
  if (isBuiltinObjectId(selfId)) return;

  const list = thread.contextWindows ?? (thread.contextWindows = []);
  let peers: string[];
  try {
    const { siblings, children } = await discoverStoneHierarchicalPeers(
      deriveStoneFromThread(persistence),
    );
    peers = [...siblings, ...children].filter((p) => p !== selfId && p !== "user");
  } catch (err) {
    console.debug(
      `[peer-windows] discover io_error self=${selfId} msg=${(err as Error).message}`,
    );
    return;
  }

  if (peers.length === 0) return;

  const now = Date.now();
  const existingIds = new Set(list.map((w) => w.id));
  const newWindows: ContextWindow[] = [];
  for (const peerId of peers) {
    if (existingIds.has(peerId)) continue;
    newWindows.push({
      id: peerId,
      class: peerId as any,
      parentWindowId: ROOT_WINDOW_ID,
      title: `peer: ${peerId}`,
      status: "open",
      createdAt: now,
    } as ContextWindow);
  }
  if (newWindows.length > 0) {
    // 位置：放在 self window 之后、creator window 之前；与 self window 同属
    // "Object 身份/环境层"。这里简单 push 到尾部即可——creator window 通常是
    // prepend，self window 也是 prepend；实际显示顺序由 XmlRenderer 按语义排序。
    thread.contextWindows = [...list, ...newWindows];
  }
}

// ── Member windows (agent 组合声明持有的 tool-object 成员) ──────────────────

/** 读一个 stone/class 的 package.json，取 `ooc.members` 与 `ooc.class`（父类）。读不到返回 {}。 */
async function readPkgMembersAndClass(
  ref: StoneObjectRef,
): Promise<{ members?: string[]; parentClass?: string }> {
  const dir = resolveBuiltinReadDir(ref) ?? stoneDir(ref);
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      ooc?: { members?: unknown; class?: unknown };
    };
    const m = pkg?.ooc?.members;
    const c = pkg?.ooc?.class;
    return {
      members: Array.isArray(m) ? m.filter((x): x is string => typeof x === "string" && x.length > 0) : undefined,
      parentClass: typeof c === "string" && c.length > 0 ? c : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * 读某对象**声明的成员**（组合：Object 像持有 data 一样持有 objects）。
 *
 * 沿 **class 链** 自底向上找首个声明 `ooc.members` 的层（与 method/knowledge 继承一致）：
 * 实例自身 → 其 `ooc.class` → 该 class 的 `ooc.class` → …。成员声明放在 agent 基类上、
 * 具体 agent 经链继承：如 supervisor 实例 → `_builtin/supervisor` → `_builtin/agent`
 * （声明 `members:["filesystem","terminal"]`）。环安全 + 深度上限 16。
 *
 * 返回成员的 **type/id 串**（如 "filesystem"）；整条链都无声明返回 []。
 */
async function readDeclaredMembers(ref: StoneObjectRef): Promise<string[]> {
  const seen = new Set<string>();
  let cur: StoneObjectRef | undefined = ref;
  let depth = 0;
  while (cur && depth < 16) {
    if (seen.has(cur.objectId)) break;
    seen.add(cur.objectId);
    const { members, parentClass } = await readPkgMembersAndClass(cur);
    if (members && members.length > 0) return members;
    cur = parentClass ? { baseDir: ref.baseDir, objectId: parentClass } : undefined;
    depth++;
  }
  return [];
}

/**
 * 组合注入 —— 把 agent 类声明持有的 tool-object 成员（如 filesystem）作为 first-class
 * 可 exec 的 ContextWindow 注入 thread.contextWindows。
 *
 * 设计：成员是单例 builtin 类型（registry 已 seed + 全局注册，无需每轮 type 注册——
 * 这点比 peer 注入更简单）。member 窗：
 * - id = class = 成员 type 串（singleton：id 稳定 = type）
 * - isMemberWindow=true → 非持久化（每轮 init 幂等重注入，不落 thread-context.json 死 _ref）
 * - exec 路由不变：window_id="filesystem" → requireParent 命中 → registry.lookupMethod 解析其方法
 *
 * 幂等：已存在则跳过。IO 失败静默吞（debug log），不阻塞 thread 启动。
 */
export async function injectMemberWindowsIfObjectThread(thread: ThreadContext): Promise<void> {
  const persistence = thread.persistence;
  const selfId = persistence?.objectId;
  if (!persistence || !selfId || selfId === "user") return;

  let members: string[];
  try {
    members = await readDeclaredMembers(deriveStoneFromThread(persistence));
  } catch (err) {
    console.debug(
      `[member-windows] read io_error self=${selfId} msg=${(err as Error).message}`,
    );
    return;
  }
  if (members.length === 0) return;

  const list = thread.contextWindows ?? (thread.contextWindows = []);
  const existingIds = new Set(list.map((w) => w.id));
  const now = Date.now();
  const newWindows: ContextWindow[] = [];
  for (const memberType of members) {
    if (existingIds.has(memberType)) continue;
    newWindows.push({
      id: memberType,
      class: memberType as any,
      parentWindowId: ROOT_WINDOW_ID,
      title: `member: ${memberType}`,
      status: "open",
      createdAt: now,
      isMemberWindow: true,
    } as ContextWindow);
  }
  if (newWindows.length > 0) {
    thread.contextWindows = [...list, ...newWindows];
  }
}
