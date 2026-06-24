/**
 * Peer windows（sibling + level-1 children）—— 把同级 sibling 与直属 children peer Object
 * 作为真实可 exec 的 ContextWindow 注入 thread.contextWindows。
 *
 * 设计依据：OOC Object 的 context 默认"身边"就是它的同级/子级 Object，这些 Object 应当以
 * first-class window 形式存在。**创建期 eager 注入**（环境发现、async IO）——与 construct 期铺设的
 * self/thread/member 窗（`initThreadContextWindows`，纯函数）分离；每轮渲染 buildInputItems 另有
 * reconcile 兜底（惰性补齐）。
 *
 * 语义：
 * - window id = peer objectId（稳定，跨 session 不变）；幂等（按 id 去重）。
 * - peer type 的 registry 注册不在此——那是每轮渲染期 PeerProcessor 的职责。
 * - IO 失败静默吞（debug log），不阻塞 thread 启动。
 */

import { ROOT_WINDOW_ID } from "@ooc/core/types/context-window.js";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import { materializeWindow } from "@ooc/core/runtime/session-object-table.js";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import {
  deriveStoneFromThread,
  discoverStoneHierarchicalPeers,
  isBuiltinObjectId,
} from "@ooc/core/persistable/index.js";

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
  const newInstances: OocObjectRef[] = [];
  for (const peerId of peers) {
    if (existingIds.has(peerId)) continue;
    newInstances.push(
      materializeWindow(thread, {
        id: peerId,
        class: peerId,
        data: {},
        parentWindowId: ROOT_WINDOW_ID,
        title: `peer: ${peerId}`,
        status: "open",
        createdAt: now,
        // peer 窗每轮幂等重注入（discover 派生）→ 非持久化。
        win: { transient: true },
      }),
    );
  }
  if (newInstances.length > 0) {
    thread.contextWindows = [...list, ...newInstances];
  }
}
