/**
 * agent.talk —— agency 核心：开启一个持续会话 talk_window。
 *
 * 统一两种会话形态（construct 纯化后，**会话副作用归本方法 caller-side**，不再经 generic
 * runtime.instantiate 委托 thread construct 隐式 side-create）：
 * - target = 别的 objectId（"user" 也是）⇒ peer 跨对象会话（需 title；同一 target 复用同一窗）。
 *   建一条 peer 会话窗（指针 data={target,title}），**不立即建 callee thread**——首条 say 由
 *   talk-delivery 懒建 callee（disk 派送）。
 * - target = 自己的 objectId ⇒ fork 一条同对象子线程（需 msg；wait 可选）。经 `openForkChild`
 *   造子线程 + 父挂子（内存树，scheduler 同 job 内跑）+ 投初始消息，并在父侧建 fork 会话窗。
 */

import type {
  ExecutableContext,
  ObjectMethod,
} from "@ooc/core/executable/contract.js";
import type { SelfProxy } from "@ooc/core/_shared/types/self-proxy.js";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import { generateWindowId, ROOT_WINDOW_ID } from "@ooc/core/_shared/types/context-window.js";
import { materializeWindow } from "@ooc/core/runtime/session-object-table.js";
import { openForkChild } from "@ooc/builtins/agent/thread/executable/fork.js";
import { peerTargetExists } from "@ooc/builtins/agent/thread/executable/peer-target.js";
import type { Data } from "../types.js";

const TALK_TIP = `talk 开启一个持续会话 talk_window。
- target=别的 objectId（"user" 也是）⇒ peer 跨对象会话（需 title；同一 target 复用同一窗，别每条消息重开）。
- target=自己的 objectId ⇒ fork 一条同对象子线程（需 msg；wait 可选）。`;

function deriveTitle(raw: string, max = 60): string {
  const t = raw.trim();
  return t.length <= max ? t : `${t.slice(0, max)}...`;
}

export const talkMethod: ObjectMethod<Data> = {
  name: "talk",
  description:
    "Open a talk_window: target=another object ⇒ peer conversation; target=self ⇒ fork a child thread.",
  schema: {
    args: {
      target: {
        type: "string",
        required: true,
        description: '目标 objectId（别的对象 / "user" ⇒ peer；自己 ⇒ fork 子线程）',
      },
      title: { type: "string", required: false, description: "peer 会话主题（peer 形态必填）" },
      msg: { type: "string", required: false, description: "fork 子线程初始消息（fork 形态必填）" },
      wait: { type: "boolean", required: false, description: "（fork）true 时父线程等待子线程回写" },
    },
  },
  exec: async (ctx: ExecutableContext, _self: SelfProxy<Data>, args: Record<string, unknown>) => {
    const target = typeof args.target === "string" ? args.target.trim() : "";
    if (!target) return `[talk] ${TALK_TIP}`;
    const hasTitle = typeof args.title === "string" && args.title.trim().length > 0;
    const hasMsg = typeof args.msg === "string" && args.msg.trim().length > 0;
    if (!hasTitle && !hasMsg) {
      return `[talk] target=${target} 时需要 title（peer）或 msg（fork）之一。\n${TALK_TIP}`;
    }
    const ownerThread = ctx.ownerThread;
    if (!ownerThread) return `[talk] ${TALK_TIP}\n（无运行 thread，无法开启会话窗）`;
    const selfObjectId = ctx.object.id;

    // ── fork：target=自己 ⇒ 同对象子线程 ──
    if (target === selfObjectId) {
      const msg = typeof args.msg === "string" ? args.msg : "";
      if (!msg.trim()) return `[talk] fork（target=自己）需要 msg 参数（给子线程的初始消息）。`;
      const child = openForkChild(ownerThread, {
        selfObjectId,
        msg,
        wait: args.wait === true,
        title: typeof args.title === "string" ? deriveTitle(args.title) : undefined,
      });
      // 父侧 fork 会话窗（指向子线程；say 经 targetThreadId 走内存树派送）。
      const forkWin = materializeWindow(ownerThread, {
        id: generateWindowId("talk"),
        class: THREAD_CLASS_ID,
        data: { target: selfObjectId, targetThreadId: child.id, isForkWindow: true },
        parentWindowId: ROOT_WINDOW_ID,
        title: typeof args.title === "string" ? deriveTitle(args.title) : `fork ${child.id}`,
        status: "open",
        createdAt: Date.now(),
      });
      ownerThread.contextWindows = [...(ownerThread.contextWindows ?? []), forkWin];
      await ctx.reportContextEdit?.();
      return `已 fork 子线程（id=${child.id}）。`;
    }

    // ── peer：target=别的对象 ⇒ 建会话窗（callee thread 首条 say 懒建）──
    if (!hasTitle) return `[talk] peer 会话（target=${target}）需要 title 参数。`;
    if (!(await peerTargetExists(ctx.persistence, target))) {
      return `[talk] target \`${target}\` 不存在（本 session worktree 与 main canonical 均未找到该对象）。请检查拼写；新对象先 create_object 再 talk。`;
    }
    const peerWin = materializeWindow(ownerThread, {
      id: generateWindowId(THREAD_CLASS_ID),
      class: THREAD_CLASS_ID,
      data: { target, title: deriveTitle(String(args.title)) },
      parentWindowId: ROOT_WINDOW_ID,
      title: deriveTitle(String(args.title)),
      status: "open",
      createdAt: Date.now(),
    });
    ownerThread.contextWindows = [...(ownerThread.contextWindows ?? []), peerWin];
    await ctx.reportContextEdit?.();
    return `已开启 peer 会话窗（target=${target}）。`;
  },
};
