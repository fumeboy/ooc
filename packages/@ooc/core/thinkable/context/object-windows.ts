/**
 * 把 stone 上的 OOC Object 带进 context —— 两个渲染期职责：
 *
 * - `ensureSelfObjectTypeRegistered`：渲染前确保 thread 自己的 Object 类型已注册进 registry，
 *   否则 renderer 取不到它的 methods / readable。由 SystemProcessor 调用。
 * - `derivePeerObjectWindows`：把 peer / children Object 注入成 context window（type=peerId），
 *   顺带注册其类型。由 PeerProcessor 调用。
 *
 * 这里是 world stone 对象类型注册进 registry 的**唯一路径**（渲染期 lazy ensure）：
 * think/exec/render 经全局 builtinRegistry，stone 类型在首次进入某 thread 的 context 时
 * 经 resolveStoneIdentityRef(read) 从磁盘（session worktree 或 main）加载并注册；registry
 * 已有该 type 则跳过（幂等）。
 */

import {
  deriveStoneFromThread,
  discoverStoneHierarchicalPeers,
  readExecutableSource,
  readReadable,
  readStoneClass,
  resolveStoneIdentityRef,
} from "../../persistable/index.js";
import type { ThreadContext } from "./index.js";
import type { ObjectRegistry, ObjectDefinition } from "../../executable/windows/_shared/registry.js";
import { builtinRegistry } from "../../executable/windows/index.js";
import type { ContextWindow, TalkWindow } from "../../executable/windows/_shared/types.js";
import { SUPER_ALIAS_TARGET } from "@ooc/core/_shared/types/constants.js";
import { xmlElement, xmlText } from "@ooc/core/_shared/types/xml.js";
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
 * 渲染失败 self window 的 readable hook：把 code load 失败显式注入 self window，让 agent 在
 * context 里看到「你的方法库没装上」而非以为方法不存在。fail-loud 的可见落点。
 */
function makeSelfLoadErrorReadable(selfId: string, message: string): ObjectDefinition["readable"] {
  return () => [
    xmlElement("executable_load_error", { object_id: selfId }, [
      xmlText(
        `你的 executable/index.ts 加载失败，因此本对象的所有自定义 method 当前都不可用——` +
          `不要假装它们不存在、更不要据此编造结果。先修复 executable/index.ts 再调用。\n失败原因：${message}`,
      ),
    ]),
  ];
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
  // session-aware：business session 内的 self 可能是本 session 新建对象（落 worktree，
  // 未合 main）——经 resolveStoneIdentityRef(read) 路由到 worktree 读其 executable/index.ts，
  // 否则 startup registrar（只扫 stones/）注册不到它，render 取不到 methods/readable。
  const stoneRef = await resolveStoneIdentityRef(
    { baseDir: thread.persistence!.baseDir, sessionId: thread.persistence!.sessionId, objectId: selfId },
    "read",
  );
  try {
    const objWin = await loadObjectWindow(stoneRef);
    await registerStoneObjectType(registry, selfId, objWin, stoneRef);
  } catch (err) {
    const message = (err as Error).message;
    // 区分两种失败：磁盘上有 executable/index.ts 但 load 抛错 = 真错误（broken import /
    // 语法错 / top-level throw），不能静默当「无方法」兜底——否则 agent 以为方法不存在而编造。
    // 磁盘上根本没有 executable/index.ts = 合法的纯 self.md/readable.md 对象，安静注空即可。
    let hasExecutable = false;
    try {
      hasExecutable = (await readExecutableSource(stoneRef)) !== undefined;
    } catch {
      // intentional: 探测 executable 是否存在时的 IO 失败不应掩盖原始 load error；
      // 视作「无法确认有文件」，保守按无 executable 处理（仅在原始 load 已失败的分支）。
      hasExecutable = false;
    }
    if (hasExecutable) {
      // fail-loud：文件存在却 load 失败。loud warn（不再是 console.debug 黑洞）+ 把错误注入
      // self window 的 readable，让 agent 在 context 里直接看到方法库没装上。
      console.warn(
        `[object-windows] self executable LOAD FAILED self=${selfId} —— methods 不可用，已把错误注入 self window readable. msg=${message}`,
      );
      registry.registerNewObjectType(selfId as any, {
        methods: {},
        readable: makeSelfLoadErrorReadable(selfId, message),
      });
    } else {
      // 无 executable/index.ts：合法的纯 self.md/readable.md 对象，空 methods 正确，安静注册。
      console.debug(`[object-windows] self no executable self=${selfId} msg=${message}`);
      registry.registerNewObjectType(selfId as any, { methods: {} });
    }
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
  const { baseDir, objectId: selfId, sessionId } = thread.persistence;

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
      // session-aware：peer 可能是本 session 新建对象（含本 thread 刚 talk 过的新对象，
      // 落 worktree 未合 main）——经 worktree ref 读它的 readable / executable，否则
      // readReadable/loadObjectWindow 落 main 找不到 → peer 类型注册不到 → 不可 talk。
      const peerStoneRef = await resolveStoneIdentityRef({ baseDir, sessionId, objectId: peerId }, "read");
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
