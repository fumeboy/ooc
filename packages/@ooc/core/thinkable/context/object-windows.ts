/**
 * 把 stone 上的 OOC Object 带进 context —— 两个渲染期职责：
 *
 * - `ensureSelfObjectTypeRegistered`：渲染前确保 thread 自己的 Object class 已注册进 registry，
 *   否则 renderer 取不到它的 object method / readable 投影。由 SystemProcessor 调用。
 * - `derivePeerObjectWindows`：把 peer / children Object 注入成 context window（一条
 *   `OocObjectInstance`，class=peerId），顺带注册其 class。由 PeerProcessor 调用。
 *
 * 这里是 world stone 对象 class 注册进 registry 的**唯一路径**（渲染期 lazy ensure）：
 * think/exec/render 经全局 builtinRegistry，stone class 在首次进入某 thread 的 context 时
 * 经 resolveStoneIdentityRef(read) 从磁盘（session worktree 或 main）加载 `export const Class`
 * 并注册（loadAndRegisterStoneClass）；registry 已有该 class 则跳过（幂等）。
 */

import {
  deriveStoneFromThread,
  discoverStoneHierarchicalPeers,
  readExecutableSource,
  readReadable,
  resolveStoneIdentityRef,
} from "../../persistable/index.js";
import type { ThreadContext } from "./index.js";
import type { ObjectRegistry, RegisteredClass } from "../../runtime/object-registry.js";
import { builtinRegistry } from "../../runtime/object-registry.js";
import type { OocObjectInstance } from "../../runtime/ooc-class.js";
import type { OocClass } from "../../runtime/ooc-class.js";
import type { ReadableContext, ReadableProjection } from "../../readable/contract.js";
import { SUPER_ALIAS_TARGET, isTalkLikeClass } from "@ooc/core/_shared/types/constants.js";
import { xmlElement, xmlText } from "@ooc/core/_shared/types/xml.js";
import { defaultServerLoader } from "../../runtime/server-loader.js";

/**
 * 一个把 code load 失败注入 self window 的 readable 投影 —— 让 agent 在 context 里看到
 * 「你的方法库没装上」而非以为方法不存在。fail-loud 的可见落点。
 *
 * 注册成一个最小 OocClass（只有 readable），class=self → renderer 投影出此错误内容。
 */
function makeSelfLoadErrorClass(selfId: string, message: string): OocClass {
  const projection: ReadableProjection = {
    class: selfId,
    content: [
      xmlElement("executable_load_error", { object_id: selfId }, [
        xmlText(
          `你的 index.ts（executable）加载失败，因此本对象的所有自定义 method 当前都不可用——` +
            `不要假装它们不存在、更不要据此编造结果。先修复 index.ts 再调用。\n失败原因：${message}`,
        ),
      ]),
    ],
  };
  return {
    readable: {
      readable: (_ctx: ReadableContext) => projection,
      window: [],
    },
  };
}

/**
 * 动态注册 thread 自己的 Object class（stone-backed）。
 *
 * thread.persistence.objectId 是 thread 的 self window class，但 builtin registry 不认识 stone
 * 对象 class——渲染前须从磁盘加载 `export const Class` 并注册。peer class 由 derivePeerObjectWindows 处理。幂等。
 */
/**
 * 一个注册是否「实质」——有任一维度模块（construct/executable/readable/persistable）或 parentClass。
 * 空占位 `{}`（无任何字段、parentClass 也空）= 前一次 load miss 的产物，不算实质（应重试加载）。
 */
function isSubstantiveRegistration(def: RegisteredClass): boolean {
  return !!(
    def.construct ||
    def.executable ||
    def.readable ||
    def.persistable ||
    (def.parentClass !== null && def.parentClass !== undefined)
  );
}

export async function ensureSelfObjectTypeRegistered(
  thread: ThreadContext,
  registry: ObjectRegistry = builtinRegistry,
): Promise<void> {
  const selfId = thread.persistence?.objectId;
  if (!selfId || selfId === "user") return;
  // 幂等：只对**实质注册**（有 construct/executable/readable/persistable 任一，或有 parentClass）跳过。
  // 空占位（前一次源码瞬时不可见——对象未提交 stone 仓 / worktree 未就绪——的 load miss 产物）不算实质：
  // 重试加载以从瞬时 miss 恢复。否则空占位会毒化进程级 builtinRegistry、幂等守卫此后永不复原（须重启）。
  const existing = registry.getClass(selfId);
  if (existing && isSubstantiveRegistration(existing)) return;
  // session-aware：business session 内的 self 可能是本 session 新建对象（落 worktree，
  // 未合 main）——经 resolveStoneIdentityRef(read) 路由到 worktree 读其 index.ts，
  // 否则 startup registrar（只扫 stones/）注册不到它，render 取不到 method/readable。
  const stoneRef = await resolveStoneIdentityRef(
    { baseDir: thread.persistence!.baseDir, sessionId: thread.persistence!.sessionId, objectId: selfId },
    "read",
  );
  try {
    // loadAndRegisterStoneClass：有 index.ts → 注册 Class 返 true；纯 self.md/readable.md 对象 → 返 false。
    const registered = await defaultServerLoader.loadAndRegisterStoneClass(stoneRef, selfId, registry);
    if (!registered) {
      // 无 index.ts：合法的纯 self.md/readable.md 对象。注册一个空 class（readable 走磁盘 readable.md 回退）。
      registry.register(selfId, {});
    }
  } catch (err) {
    const message = (err as Error).message;
    // 区分两种失败：磁盘上有 executable 源但 load 抛错 = 真错误（broken import / 语法错 /
    // top-level throw），不能静默当「无方法」兜底——否则 agent 以为方法不存在而编造。
    // 磁盘上根本没有 executable 源 = 合法的纯 self.md/readable.md 对象，安静注空即可。
    let hasExecutable = false;
    try {
      hasExecutable = (await readExecutableSource(stoneRef)) !== undefined;
    } catch {
      // 探测 IO 失败不应掩盖原始 load error；保守按无 executable 处理。
      hasExecutable = false;
    }
    if (hasExecutable) {
      // fail-loud：源存在却 load 失败。loud warn + 把错误注入 self window 的 readable 投影。
      console.warn(
        `[object-windows] self class LOAD FAILED self=${selfId} —— methods 不可用，已把错误注入 self window readable. msg=${message}`,
      );
      registry.register(selfId, makeSelfLoadErrorClass(selfId, message));
    } else {
      // 无 executable 源：合法的纯 self.md/readable.md 对象，空 class 正确，安静注册。
      console.debug(`[object-windows] self no executable self=${selfId} msg=${message}`);
      registry.register(selfId, {});
    }
  }
}

/**
 * 派生 peer / children Object 窗口：peer/children OOC Object 本身以一条 `OocObjectInstance`
 * （class=peerId）进 context。
 *
 * 机制：
 * 1. 从 talk_window(target=peerId) 收集交互过的 peer
 * 2. 从 stone 层级收集默认可见的 sibling + 一级 children
 * 3. 每个 peer 造一条 OocObjectInstance（class=peerId, id=peerId），title 取其 readable.md frontmatter
 * 4. 动态注册每个 peer 的 class
 */
export async function derivePeerObjectWindows(
  thread: ThreadContext,
  registry: ObjectRegistry = builtinRegistry,
): Promise<OocObjectInstance[]> {
  if (!thread.persistence) return [];
  const { baseDir, objectId: selfId, sessionId } = thread.persistence;

  // 1) From 会话窗（talk other-view + thread/reflect_request self-view）。
  // 自视图（creator 窗）的 target = 本 thread 的 creator object（cross-object callee 借此把它的 caller
  // 也带成 peer object window）；故按 isTalkLikeClass 认会话窗，而非只认 other-view "talk"。
  const talkWindows = (thread.contextWindows ?? []).filter((w) =>
    isTalkLikeClass(w.class),
  );
  const peerEarliest = new Map<string, number>();
  for (const w of talkWindows) {
    const target = (w.data as { target?: string } | undefined)?.target;
    if (!target) continue;
    if (target === SUPER_ALIAS_TARGET) continue;
    // user 不再特殊排除：talk 过的对端对象（含 user）统一作 peer object window 进 context。
    const prev = peerEarliest.get(target);
    if (prev === undefined || w.createdAt < prev) peerEarliest.set(target, w.createdAt);
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

  const out: OocObjectInstance[] = [];
  for (const [peerId, createdAt] of peerEarliest) {
    let title = `peer: ${peerId}`;
    try {
      // session-aware：peer 可能是本 session 新建对象（含本 thread 刚 talk 过的新对象，
      // 落 worktree 未合 main）——经 worktree ref 读它的 readable / Class，否则
      // readReadable/loadStoneClass 落 main 找不到 → peer class 注册不到 → 不可 talk。
      const peerStoneRef = await resolveStoneIdentityRef({ baseDir, sessionId, objectId: peerId }, "read");
      const readable = await readReadable(peerStoneRef);
      if (readable) {
        const frontmatterMatch = readable.match(/^---\n([\s\S]*?)\n---/);
        const titleMatch = frontmatterMatch?.[1].match(/^title:\s*(.+)$/m);
        if (titleMatch) title = titleMatch[1].trim();
      }

      if (!registry.has(peerId)) {
        await defaultServerLoader.loadAndRegisterStoneClass(peerStoneRef, peerId, registry);
      }
    } catch {
      // ignore — fail-soft，未注册的 peer 由 render 路径占位处理
    }

    out.push({
      id: peerId,
      class: peerId,
      parentObjectId: "root",
      title,
      status: "open",
      createdAt,
      data: {},
    });
  }

  return out;
}
