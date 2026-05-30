/**
 * do_window.move method —— 跨 thread 共享 / 移交 ContextWindow（plan §do_window.move）。
 *
 * 调用形态：
 *   exec(window_id=<do_window_id>, method="move", args={ window_id: <target_window>, mode: "ref" | "move" })
 *
 * - do_window 是父子双向通道；父→子用父侧 do_window；子→父用 creator do_window（指向父）
 * - mode="ref"：对端获得只读 snapshot；自己保留 owner 继续 live
 * - mode="move"：所有权移交对端；自己变 lent_out 占位（看 snapshot）
 *
 * 归还路径：当 borrower 用 mode="move" 把 window 还回原 owner 所在 thread 时，
 *   按 id 检测到对端有同 id 的 lent_out（borrowerThreadId === self.id）→ 视为归还，
 *   对端恢复 owner（用 borrower 的 latest 内容），自己上的 owner 副本被移除。
 */

import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
} from "../_shared/method-types.js";
import type { ContextWindow, DoWindow, SharingState } from "../_shared/types.js";
import type { ThreadContext } from "../../../thinkable/context.js";
import { findChild } from "./helpers.js";

const MOVE_BASIC_PATH = "internal/windows/do/move/basic";
const MOVE_REF_PATH = "internal/windows/do/move/ref";
const MOVE_MOVE_PATH = "internal/windows/do/move/move";
const MOVE_RETURN_PATH = "internal/windows/do/move/return";

const MOVE_BASIC_KNOWLEDGE = `
do_window.move 用于通过本 do_window 把 ContextWindow 分享 / 移交给对端 thread。

参数：
- window_id: 必填，要分享的 window id（必须在自己的 contextWindows 里且当前是 owner，没有 sharing 字段）
- mode: "ref" | "move"

模式：
- ref：对端获得只读 snapshot；自己保留 owner，继续 live 操作
- move：所有权移交对端；自己变 lent_out 占位（看 snapshot），临时只读

归还（自动识别）：
- 当 borrower 在 creator do_window 上用 mode="move" 把 window 还回时，
  按 id 检测到对端有同 id 的 lent_out → 视为归还：
  对端恢复 owner（用 borrower 的 latest 内容），自己上的 owner 副本被移除。
`.trim();

const MOVE_REF_KNOWLEDGE = `
do_window.move (ref)：把 window 的只读副本送给对端。
对端会看到分享时刻的 snapshot 内容；之后你（owner）的改动不会同步给对端。
对端 close 该 ref 时只是释放本地引用，不影响你的 owner。
`.trim();

const MOVE_MOVE_KNOWLEDGE = `
do_window.move (move)：把 owner 移交给对端。
执行后：
- 你自己的 window 变成 lent_out 占位，临时只读，看分享时刻的 snapshot
- 对端获得完整 owner 副本，可以正常 exec / refine / submit
- 对端线程 archive 时所有权自动归还给你（同 id lent_out 配对）
- 对端也可以显式用 mode="move" 在 creator do_window 上发起归还
`.trim();

const MOVE_RETURN_KNOWLEDGE = `
do_window.move (return)：归还路径。
你已通过某条 creator do_window 持有从对端 move 来的 owner；现在用 mode="move" 把它送回。
系统按 id 自动识别 lent_out 配对：原 owner 恢复 live，吸收你的 latest 内容；你的副本被移除。
`.trim();

interface MoveArgs {
  window_id: string;
  mode: "ref" | "move";
}

function parseArgs(raw: Record<string, unknown>): MoveArgs | string {
  const wid = raw.window_id;
  const mode = raw.mode;
  if (typeof wid !== "string" || wid.length === 0) {
    return "[do_window.move] 缺少 window_id 参数（要分享的 window id）。";
  }
  if (mode !== "ref" && mode !== "move") {
    return `[do_window.move] mode 必须是 "ref" 或 "move"，收到：${JSON.stringify(mode)}。`;
  }
  return { window_id: wid, mode };
}

/** 把 window 内容深拷贝为 freeze snapshot（不带 sharing 字段）。 */
function makeSnapshot(window: ContextWindow): ContextWindow {
  // 简单 JSON deep-clone；ContextWindow 字段全是 JSON-safe
  const cloned = JSON.parse(JSON.stringify(window)) as ContextWindow;
  delete (cloned as { sharing?: SharingState }).sharing;
  return cloned;
}

/** 解析 do_window 的对端 thread：targetThreadId 可能是子（典型）或父（creator do_window）。 */
function resolvePeerThread(
  selfThread: ThreadContext,
  doWindow: DoWindow,
): ThreadContext | null {
  // 先查子树（父→子方向，标准 do_window）
  const child = findChild(selfThread, doWindow.targetThreadId);
  if (child && child.id !== selfThread.id) return child;
  // 再查父链（子→父方向，creator do_window）
  let cur: ThreadContext | undefined = selfThread._parentThreadRef;
  while (cur) {
    if (cur.id === doWindow.targetThreadId) return cur;
    cur = cur._parentThreadRef;
  }
  return null;
}

async function executeMove(ctx: MethodExecutionContext): Promise<string | undefined> {
  const self = ctx.thread;
  if (!self) return "[do_window.move] 缺少 thread context。";
  const doWindow = ctx.parentWindow;
  if (!doWindow || doWindow.type !== "do") {
    return "[do_window.move] 必须挂载在 do_window 上调用。";
  }
  if (doWindow.status !== "running") {
    return `[do_window.move] do_window ${doWindow.id} 状态为 ${doWindow.status}（非 running），不能再分享 window。`;
  }

  const parsed = parseArgs(ctx.args);
  if (typeof parsed === "string") return parsed;
  const { window_id, mode } = parsed;

  // 找对端 thread
  const peer = resolvePeerThread(self, doWindow);
  if (!peer) {
    return `[do_window.move] 找不到对端 thread "${doWindow.targetThreadId}"。`;
  }

  // 找 source window（必须是 self.contextWindows 里的 owner）
  const selfWindows = self.contextWindows ?? [];
  const sourceIdx = selfWindows.findIndex((w) => w.id === window_id);
  if (sourceIdx < 0) {
    return `[do_window.move] window "${window_id}" 不在当前 thread 的 contextWindows 里。`;
  }
  const source = selfWindows[sourceIdx]!;
  if (source.sharing) {
    const stateDesc =
      source.sharing.kind === "ref"
        ? `只读 ref（owner 在 thread "${source.sharing.ownerThreadId}"）`
        : `已借出给 thread "${source.sharing.borrowerThreadId}"`;
    return `[do_window.move] window "${window_id}" 当前是 ${stateDesc}，不能再分享。`;
  }
  if (source.id === doWindow.id || source.type === "do" || source.type === "command_exec" || source.type === "root") {
    return `[do_window.move] window "${window_id}" 是 ${source.type} 类型，不允许分享（仅可分享数据 / 内容型 window）。`;
  }

  const peerWindows = peer.contextWindows ?? (peer.contextWindows = []);

  if (mode === "ref") {
    // 对端已有同 id → 拒绝
    if (peerWindows.some((w) => w.id === window_id)) {
      return `[do_window.move] 对端 thread "${peer.id}" 已有同 id window "${window_id}"，不能重复分享。`;
    }
    const snapshot = makeSnapshot(source);
    const refPlaceholder: ContextWindow = {
      ...snapshot,
      sharing: {
        kind: "ref",
        ownerThreadId: self.id,
        lentByWindowId: doWindow.id,
        sharedAt: Date.now(),
        snapshot,
      },
    };
    peer.contextWindows = [...peerWindows, refPlaceholder];
    return `[do_window.move] 已将 window "${window_id}" 以 ref 模式分享给 thread "${peer.id}"（owner 仍在你这边）。`;
  }

  // mode === "move"
  const peerSameIdIdx = peerWindows.findIndex((w) => w.id === window_id);
  if (peerSameIdIdx >= 0) {
    const peerWindow = peerWindows[peerSameIdIdx]!;
    // 归还路径：对端持有 lent_out 且 borrowerThreadId === self.id
    if (
      peerWindow.sharing?.kind === "lent_out" &&
      peerWindow.sharing.borrowerThreadId === self.id
    ) {
      // 把 self 的 owner 副本（latest 内容）覆写到 peer，清掉 lent_out
      const returned: ContextWindow = { ...source };
      delete (returned as { sharing?: SharingState }).sharing;
      peerWindows[peerSameIdIdx] = returned;
      // 移除 self 的 owner 副本（同时通过 mgr 同步以避免被 toData() 复原）
      self.contextWindows = selfWindows.filter((_, i) => i !== sourceIdx);
      ctx.manager?.removeWindowSilent(window_id);
      peer.contextWindows = peerWindows;
      return `[do_window.move] 已归还 window "${window_id}" 给 thread "${peer.id}"（其 owner 状态已恢复）。`;
    }
    return `[do_window.move] 对端 thread "${peer.id}" 已有同 id window "${window_id}"，且不是预期的归还配对（owner 在第三方）。`;
  }

  // 新移交：self → lent_out + snapshot；peer 获得完整 owner
  const snapshot = makeSnapshot(source);
  const lentOut: ContextWindow = {
    ...snapshot,
    sharing: {
      kind: "lent_out",
      borrowerThreadId: peer.id,
      lentToWindowId: doWindow.id,
      sharedAt: Date.now(),
      snapshot,
    },
  };
  selfWindows[sourceIdx] = lentOut;
  self.contextWindows = selfWindows;
  // 同步 mgr 状态（避免后续 toData() 把它恢复为旧 owner）
  ctx.manager?.upsertWindow(lentOut);
  // peer 获得完整 owner 副本（不带 sharing）
  const ownerCopy: ContextWindow = { ...source };
  delete (ownerCopy as { sharing?: SharingState }).sharing;
  peer.contextWindows = [...peerWindows, ownerCopy];

  return `[do_window.move] 已将 window "${window_id}" 移交给 thread "${peer.id}"（你这边变为 lent_out 临时只读，等其归还）。`;
}

export const moveCommand: MethodEntry = {
  paths: ["move", "move.ref", "move.move"],
  match: (args) => {
    const hit: string[] = ["move"];
    if (args.mode === "ref") hit.push("move.ref");
    if (args.mode === "move") hit.push("move.move");
    return hit;
  },
  knowledge: (_args, _formStatus): MethodKnowledgeEntries => {
    // 单 key 返回；把 ref / move / return 三个分支说明合并到 basic body 里，
    // 避免 args.mode 变化引入新 knowledge key 阻断 manager 的 auto-execute 子集判定
    return {
      [MOVE_BASIC_PATH]: [
        MOVE_BASIC_KNOWLEDGE,
        "",
        "## ref 模式",
        MOVE_REF_KNOWLEDGE,
        "",
        "## move 模式",
        MOVE_MOVE_KNOWLEDGE,
        "",
        "## 归还（return）模式",
        MOVE_RETURN_KNOWLEDGE,
      ].join("\n"),
    };
  },
  exec: (ctx) => executeMove(ctx),
};
