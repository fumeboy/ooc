/**
 * do_window.move 命令 —— 跨 thread 共享 / 移交 ContextWindow（plan §do_window.move）。
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
  ObjectMethod,
} from "../_shared/method-types.js";
import type { MethodCallSchema } from "../../../thinkable/context/intent.js";
import type { ContextWindow, DoWindow, SharingState } from "../_shared/types.js";
import type { WindowManager } from "../_shared/manager.js";
import type { ThreadContext } from "../../../thinkable/context.js";
import { findChild } from "./helpers.js";

const MOVE_TIP = `do_window.move 跨 thread 分享/移交 window。
参数：window_id（必填，要分享的 window id）、mode（"ref" 只读 snapshot 或 "move" 所有权移交）。`;

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
  // P6.§3: manager 在 dispatch 阶段已保证 self.type === "do"，method 体不再 re-check。
  const doWindow = ctx.self as DoWindow;
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
  // batch C narrowing(N4): contextWindows 元素契约层是 base；narrow 回 union ContextWindow
  // 以传入 makeSnapshot / 构造 ref/lent_out 副本（runtime 即 union 实例）。
  const source = selfWindows[sourceIdx]! as ContextWindow;
  if (source.sharing) {
    const stateDesc =
      source.sharing.kind === "ref"
        ? `只读 ref（owner 在 thread "${source.sharing.ownerThreadId}"）`
        : `已借出给 thread "${source.sharing.borrowerThreadId}"`;
    return `[do_window.move] window "${window_id}" 当前是 ${stateDesc}，不能再分享。`;
  }
  if (source.id === doWindow.id || source.type === "do" || source.type === "method_exec" || source.type === "root") {
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
      // batch C narrowing(N2): ctx.manager 契约层是 unknown，narrow 回 WindowManager。
      (ctx.manager as WindowManager | undefined)?.removeWindowSilent(window_id);
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
  // batch C narrowing(N2): ctx.manager 契约层是 unknown，narrow 回 WindowManager。
  (ctx.manager as WindowManager | undefined)?.upsertWindow(lentOut, ctx.thread);
  // peer 获得完整 owner 副本（不带 sharing）
  const ownerCopy: ContextWindow = { ...source };
  delete (ownerCopy as { sharing?: SharingState }).sharing;
  peer.contextWindows = [...peerWindows, ownerCopy];

  return `[do_window.move] 已将 window "${window_id}" 移交给 thread "${peer.id}"（你这边变为 lent_out 临时只读，等其归还）。`;
}

export const moveMethod: ObjectMethod = {
  description: "Share (ref) or transfer ownership (move) of a window to the peer thread.",
  intents: ["move.ref", "move.move"],
  schema: {
    args: {
      window_id: { type: "string", required: true, description: "要分享的 window id" },
      mode: { type: "string", required: true, enum: ["ref", "move"], description: '"ref" 只读 snapshot；"move" 所有权移交' },
    },
  } as MethodCallSchema,
  onFormChange(change, { args }) {
    const mode = args.mode as string | undefined;
    const intents = [];
    if (mode === "ref") intents.push({ name: "move.ref" });
    else if (mode === "move") intents.push({ name: "move.move" });
    else intents.push({ name: "move" });
    const hasWid = typeof args.window_id === "string" && args.window_id.length > 0;
    const hasMode = mode === "ref" || mode === "move";
    const ready = hasWid && hasMode;
    return {
      tip: ready ? `Sharing window ${args.window_id} (${mode})...` : MOVE_TIP,
      intents,
      quick_exec_submit: ready,
    };
  },
  exec: (ctx) => executeMove(ctx),
};
