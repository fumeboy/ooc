/**
 * 把 stone 上的 OOC Object 带进 context —— 两个渲染期职责：
 *
 * - `ensureSelfObjectTypeRegistered`：渲染前确保 thread 自己的 Object 类型已注册进 registry，
 *   否则 renderer 取不到它的 methods / readable。由 SystemProcessor 调用。
 * - `derivePeerObjectWindows`：把 peer / children Object 注入成 context window（type=peerId），
 *   顺带注册其类型。由 PeerProcessor 调用。
 *
 * 二者都是**渲染期惰性注册**——startup / hot-reload 的注册主路径是
 * `runtime/object-type-registrar.ts:ObjectTypeRegistrar.registerStone`；这里是兜底（时序上
 * thread 可能先于 registrar 后台扫描完成，或 session 内新建的 stone 尚未触发注册事件）。
 *
 * 注：与 registrar 的「从 windowDef 注册 stone 对象类型」逻辑同源——跨 runtime/thinkable
 * 的统一抽取留待 type-system 批协调。
 */

import {
  deriveStoneFromThread,
  discoverStoneHierarchicalPeers,
  readReadable,
  readStoneClass,
} from "../../persistable/index.js";
import type { ThreadContext } from "./index.js";
import type { ObjectRegistry, ObjectDefinition } from "../../executable/windows/_shared/registry.js";
import { builtinRegistry } from "../../executable/windows/index.js";
import type { ContextWindow, TalkWindow } from "../../executable/windows/_shared/types.js";
import { SUPER_ALIAS_TARGET } from "@ooc/core/_shared/types/constants.js";
import { loadObjectWindow } from "../../runtime/server-loader.js";

/**
 * 确保 `_builtin/<id>` 框架 class 已注册（供 instance 的 parentClass 链解析）。
 *
 * builtin class（如 supervisor）无 world 内 executable —— 注册为空 methods，缺省隐式继承 root，
 * 让 instance 的方法链 `instance → _builtin/<class> → root` 不断在未注册的 class 上。
 * 非 `_builtin/` 父类（普通 stone class）由各自注册路径负责，这里不处理。
 */
function ensureBuiltinClassRegistered(
  registry: ObjectRegistry,
  parentClass: string | null | undefined,
): void {
  if (typeof parentClass !== "string" || !parentClass.startsWith("_builtin/")) return;
  if (registry.listRegisteredObjectTypes().includes(parentClass as any)) return;
  registry.registerNewObjectType(parentClass as any, { methods: {} });
}

/**
 * 把一个 stone 对象类型注册进 registry（从其 `executable/index.ts` 的 window 声明）。
 *
 * parentClass 优先取 window 声明的 override，否则读 stone package.json 的 `ooc.class`。
 * 先确保 `_builtin/` 父类已注册，再 registerNewObjectType。
 */
async function registerStoneObjectType(
  registry: ObjectRegistry,
  objectId: string,
  windowDef: Partial<ObjectDefinition> | undefined,
  stoneRef: { baseDir: string; objectId: string },
): Promise<void> {
  const parentClass: string | null | undefined =
    windowDef?.parentClass !== undefined ? windowDef.parentClass : await readStoneClass(stoneRef);
  ensureBuiltinClassRegistered(registry, parentClass);
  registry.registerNewObjectType(objectId as any, {
    methods: { ...(windowDef?.methods ?? {}) },
    readable: windowDef?.readable,
    onClose: windowDef?.onClose,
    parentClass,
  });
}

/**
 * 动态注册 thread 自己的 Object 类型（stone-backed）。
 *
 * thread.persistence.objectId 是 thread 的 self window type，但 builtin registry 不认识 stone
 * 对象类型——渲染前须从磁盘加载并注册。peer 类型由 derivePeerObjectWindows 处理。幂等。
 */
export async function ensureSelfObjectTypeRegistered(
  thread: ThreadContext,
  registry: ObjectRegistry = builtinRegistry,
): Promise<void> {
  const selfId = thread.persistence?.objectId;
  if (!selfId || selfId === "user") return;
  if (registry.listRegisteredObjectTypes().includes(selfId as any)) return;
  const stoneRef = { baseDir: thread.persistence!.baseDir, objectId: selfId };
  try {
    const objWin = await loadObjectWindow(stoneRef);
    await registerStoneObjectType(registry, selfId, objWin, stoneRef);
  } catch (err) {
    console.debug(`[object-windows] self register io_error self=${selfId} msg=${(err as Error).message}`);
    registry.registerNewObjectType(selfId as any, { methods: {} });
  }
}

/**
 * 派生 peer / children Object 窗口：peer/children OOC Object 本身以 window（type=peerId）进 context。
 *
 * 机制：
 * 1. 从 talk_window(target=peerId) 收集交互过的 peer
 * 2. 从 stone 层级收集默认可见的 sibling + 一级 children
 * 3. 每个 peer 造一条 window（type=peerId, id=peerId），title 取其 readable.md frontmatter
 * 4. 动态注册每个 peer 的类型
 */
export async function derivePeerObjectWindows(
  thread: ThreadContext,
  registry: ObjectRegistry = builtinRegistry,
): Promise<ContextWindow[]> {
  if (!thread.persistence) return [];
  const { baseDir, objectId: selfId } = thread.persistence;

  // 1) From talk_window
  const talkWindows = (thread.contextWindows ?? []).filter(
    (w): w is TalkWindow => w.class === "talk",
  );
  const peerEarliest = new Map<string, number>();
  for (const w of talkWindows) {
    if (!w.target) continue;
    if (w.target === SUPER_ALIAS_TARGET) continue;
    if (w.target === "user") continue;
    const prev = peerEarliest.get(w.target);
    if (prev === undefined || w.createdAt < prev) peerEarliest.set(w.target, w.createdAt);
  }

  // 2) Default adjacent agents (sibling + level-1 children)
  if (selfId !== "user") {
    try {
      const { siblings, children } = await discoverStoneHierarchicalPeers(
        deriveStoneFromThread(thread.persistence),
      );
      const now = Date.now();
      for (const peer of [...siblings, ...children]) {
        if (peer === selfId || peer === "user") continue;
        if (!peerEarliest.has(peer)) peerEarliest.set(peer, now);
      }
    } catch (err) {
      console.debug(`[object-windows] hierarchical peers io_error self=${selfId} msg=${(err as Error).message}`);
    }
  }

  if (peerEarliest.size === 0) return [];

  const out: ContextWindow[] = [];
  for (const [peerId, createdAt] of peerEarliest) {
    let title = `peer: ${peerId}`;
    try {
      const peerStoneRef = { baseDir, objectId: peerId };
      const readme = await readReadable(peerStoneRef);
      if (readme) {
        const frontmatterMatch = readme.match(/^---\n([\s\S]*?)\n---/);
        const titleMatch = frontmatterMatch?.[1].match(/^title:\s*(.+)$/m);
        if (titleMatch) title = titleMatch[1].trim();
      }

      const objWin = await loadObjectWindow(peerStoneRef);
      if (objWin && !registry.listRegisteredObjectTypes().includes(peerId as any)) {
        await registerStoneObjectType(registry, peerId, objWin, peerStoneRef);
      }
    } catch {
      // ignore — fail-soft，未注册的 peer 由 render 路径占位处理
    }

    out.push({
      id: peerId,
      class: peerId as any,
      parentWindowId: "root",
      title,
      status: "open",
      createdAt,
    } as ContextWindow);
  }

  return out;
}
