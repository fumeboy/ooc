/**
 * talk_window.share —— 跨 thread 传递 window 引用（核心 11）。
 *
 * 仅 fork 子线程窗（isForkWindow=true）可调：它是父子双向通道。
 *   exec(window_id=<fork_window_id>, method="share", args={ window_id: <target_window>, mode: "readonly-ref" | "move" })
 *
 * - mode="readonly-ref"：对端获得只读引用（snapshot freeze），只能调 window method；自己仍持 mutable-ref（owner）
 * - mode="move"：把 mutable 所有权移交对端（对端升 mutable-ref / owner）；自己降只读 shadow（kind=mutable-ref，记 borrower）
 *
 * 归还：当 borrower 用 mode="move" 把 window 还回原 owner 所在 thread 时，
 *   按 id 检测到对端有同 id 的 mutable-ref shadow（borrowerThreadId === self.id）→ 视为归还，
 *   对端恢复 owner（用 borrower 的 latest 内容），自己上的 owner 副本被移除。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../_shared/method-types.js";
import type { MethodCallSchema } from "@ooc/core/_shared/types/intent.js";
import type { ContextWindow, SharingState, TalkWindow } from "../_shared/types.js";
import type { WindowManager } from "../_shared/manager.js";
import type { ThreadContext } from "../../../thinkable/context.js";
import { findChild } from "./fork.js";

const SHARE_TIP = `talk_window.share 跨 thread 传 window 引用（仅 fork 子线程窗可用）。
参数：window_id（必填，要传的 window id）、mode（"readonly-ref" 只读借用 或 "move" 移交所有权）。`;

interface ShareArgs {
  window_id: string;
  mode: "readonly-ref" | "move";
}

function parseArgs(raw: Record<string, unknown>): ShareArgs | string {
  const wid = raw.window_id;
  const mode = raw.mode;
  if (typeof wid !== "string" || wid.length === 0) {
    return "[talk_window.share] 缺少 window_id 参数（要传的 window id）。";
  }
  if (mode !== "readonly-ref" && mode !== "move") {
    return `[talk_window.share] mode 必须是 "readonly-ref" 或 "move"，收到：${JSON.stringify(mode)}。`;
  }
  return { window_id: wid, mode };
}

/** 把 window 内容深拷贝为 freeze snapshot（不带 sharing 字段）。 */
function makeSnapshot(window: ContextWindow): ContextWindow {
  const cloned = JSON.parse(JSON.stringify(window)) as ContextWindow;
  delete (cloned as { sharing?: SharingState }).sharing;
  return cloned;
}

/** 解析 fork 窗的对端 thread：targetThreadId 可能是子（典型）或父（creator fork 窗）。 */
function resolvePeerThread(
  selfThread: ThreadContext,
  forkWindow: TalkWindow,
): ThreadContext | null {
  const targetThreadId = forkWindow.targetThreadId;
  if (!targetThreadId) return null;
  // 先查子树（父→子方向，标准 fork 窗）
  const child = findChild(selfThread, targetThreadId);
  if (child && child.id !== selfThread.id) return child;
  // 再查父链（子→父方向，creator fork 窗）
  let cur: ThreadContext | undefined = selfThread._parentThreadRef;
  while (cur) {
    if (cur.id === targetThreadId) return cur;
    cur = cur._parentThreadRef;
  }
  return null;
}

async function executeShare(ctx: MethodExecutionContext): Promise<string | undefined> {
  const self = ctx.thread;
  if (!self) return "[talk_window.share] 缺少 thread context。";
  const forkWindow = ctx.self as TalkWindow;
  if (!forkWindow.isForkWindow) {
    return `[talk_window.share] share 只能在 fork 子线程窗（同对象父子通道）上调用；window "${forkWindow.id}" 是 peer 会话窗。`;
  }
  if (forkWindow.status !== "open") {
    return `[talk_window.share] window ${forkWindow.id} 状态为 ${forkWindow.status}（非 open），不能再传 window。`;
  }

  const parsed = parseArgs(ctx.args);
  if (typeof parsed === "string") return parsed;
  const { window_id, mode } = parsed;

  const peer = resolvePeerThread(self, forkWindow);
  if (!peer) {
    return `[talk_window.share] 找不到对端 thread "${forkWindow.targetThreadId}"。`;
  }

  const selfWindows = self.contextWindows ?? [];
  const sourceIdx = selfWindows.findIndex((w) => w.id === window_id);
  if (sourceIdx < 0) {
    return `[talk_window.share] window "${window_id}" 不在当前 thread 的 contextWindows 里。`;
  }
  const source = selfWindows[sourceIdx]! as ContextWindow;
  if (source.sharing) {
    const stateDesc =
      source.sharing.kind === "readonly-ref"
        ? `只读引用（owner 在 thread "${source.sharing.ownerThreadId}"）`
        : `已 move 给 thread "${source.sharing.borrowerThreadId}"`;
    return `[talk_window.share] window "${window_id}" 当前是 ${stateDesc}，不能再传。`;
  }
  if (source.id === forkWindow.id || source.class === "talk" || source.class === "method_exec" || source.class === "root") {
    return `[talk_window.share] window "${window_id}" 是 ${source.class} 类型，不允许传（仅可传数据 / 内容型 window）。`;
  }

  const peerWindows = peer.contextWindows ?? (peer.contextWindows = []);

  if (mode === "readonly-ref") {
    if (peerWindows.some((w) => w.id === window_id)) {
      return `[talk_window.share] 对端 thread "${peer.id}" 已有同 id window "${window_id}"，不能重复传。`;
    }
    const snapshot = makeSnapshot(source);
    const refPlaceholder: ContextWindow = {
      ...snapshot,
      sharing: {
        kind: "readonly-ref",
        ownerThreadId: self.id,
        lentByWindowId: forkWindow.id,
        sharedAt: Date.now(),
        snapshot,
      },
    };
    peer.contextWindows = [...peerWindows, refPlaceholder];
    return `[talk_window.share] 已将 window "${window_id}" 以 readonly-ref 模式传给 thread "${peer.id}"（owner 仍在你这边）。`;
  }

  // mode === "move"
  const peerSameIdIdx = peerWindows.findIndex((w) => w.id === window_id);
  if (peerSameIdIdx >= 0) {
    const peerWindow = peerWindows[peerSameIdIdx]!;
    // 归还路径：对端持有 mutable-ref shadow 且 borrowerThreadId === self.id
    if (
      peerWindow.sharing?.kind === "mutable-ref" &&
      peerWindow.sharing.borrowerThreadId === self.id
    ) {
      const returned: ContextWindow = { ...source };
      delete (returned as { sharing?: SharingState }).sharing;
      peerWindows[peerSameIdIdx] = returned;
      self.contextWindows = selfWindows.filter((_, i) => i !== sourceIdx);
      (ctx.manager as WindowManager | undefined)?.removeWindowSilent(window_id);
      peer.contextWindows = peerWindows;
      return `[talk_window.share] 已归还 window "${window_id}" 给 thread "${peer.id}"（其 owner 状态已恢复）。`;
    }
    return `[talk_window.share] 对端 thread "${peer.id}" 已有同 id window "${window_id}"，且不是预期的归还配对（owner 在第三方）。`;
  }

  // 新移交：self → mutable-ref shadow + snapshot；peer 获得完整 owner
  const snapshot = makeSnapshot(source);
  const shadow: ContextWindow = {
    ...snapshot,
    sharing: {
      kind: "mutable-ref",
      borrowerThreadId: peer.id,
      lentToWindowId: forkWindow.id,
      sharedAt: Date.now(),
      snapshot,
    },
  };
  selfWindows[sourceIdx] = shadow;
  self.contextWindows = selfWindows;
  (ctx.manager as WindowManager | undefined)?.upsertWindow(shadow, ctx.thread);
  const ownerCopy: ContextWindow = { ...source };
  delete (ownerCopy as { sharing?: SharingState }).sharing;
  peer.contextWindows = [...peerWindows, ownerCopy];

  return `[talk_window.share] 已将 window "${window_id}" move 给 thread "${peer.id}"（你这边降为只读 shadow，等其归还）。`;
}

export const shareMethod: ObjectMethod = {
  description: "Share (readonly-ref) or transfer ownership (move) of a window to the forked child/parent thread.",
  intents: ["share.readonly-ref", "share.move"],
  schema: {
    args: {
      window_id: { type: "string", required: true, description: "要传的 window id" },
      mode: { type: "string", required: true, enum: ["readonly-ref", "move"], description: '"readonly-ref" 只读借用；"move" 移交所有权' },
    },
  } as MethodCallSchema,
  onFormChange(change, { args }) {
    const mode = args.mode as string | undefined;
    const intents = [];
    if (mode === "readonly-ref") intents.push({ name: "share.readonly-ref" });
    else if (mode === "move") intents.push({ name: "share.move" });
    else intents.push({ name: "share" });
    const hasWid = typeof args.window_id === "string" && args.window_id.length > 0;
    const hasMode = mode === "readonly-ref" || mode === "move";
    const ready = hasWid && hasMode;
    return {
      tip: ready ? `Sharing window ${args.window_id} (${mode})...` : SHARE_TIP,
      intents,
      quick_exec_submit: ready,
    };
  },
  exec: (ctx) => executeShare(ctx),
};
