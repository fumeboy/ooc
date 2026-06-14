/**
 * wait tool — 显式声明"等指定 window 上的未来 IO 事件"，把 thread 切到 waiting。
 *
 * - `on` 必填：必须 resolve 到当前 contextWindows 一个 open 且可产生未来 IO 的 talk_window
 *   （peer 会话窗 等对端消息 / fork 子线程窗 等子线程回报）。
 * - 没有任何合法 `on` 候选时 → reject，强 nudge 改 end method。
 * - thread.inboxSnapshotAtWait 仍用于 wakeup（wakeup 逻辑不变）；
 *   thread.waitingOn 仅作 observability，不参与 wakeup 决策。
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import type { ContextWindow } from "../windows/_shared/types.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

interface WaitCandidate {
  id: string;
  class: "talk" | "reflect_request";
  hint: string;
}

/** open/可作为未来 IO 来源的 window 列表，附 hint 帮 LLM 自纠时选对。 */
function listValidWaitTargets(thread: ThreadContext): WaitCandidate[] {
  const out: WaitCandidate[] = [];
  // 窄化：contextWindows 契约层是 base[]；narrow 回 union[]，
  // switch(w.class) 才能 discriminant-narrow 到 TalkWindow 读 isCreatorWindow/isForkWindow/target/targetThreadId。
  for (const w of (thread.contextWindows ?? []) as ContextWindow[]) {
    // 会话窗（talk peer / talk fork 子窗 / reflect_request）= 唯一可产生未来 IO 的 window；alive=open。
    switch (w.class) {
      case "talk":
      case "reflect_request": {
        if (w.status !== "open") break;
        if (w.isForkWindow) {
          // fork 子线程窗：等子线程（或父线程，creator fork 窗）回报。
          out.push({
            id: w.id,
            class: w.class,
            hint: `fork (target_thread=${w.targetThreadId}) — 等${w.isCreatorWindow ? "父" : "子"}线程回报`,
          });
        } else if (w.isCreatorWindow) {
          out.push({
            id: w.id,
            class: w.class,
            hint: `creator ${w.class} (target=${w.target}) — 等创建者发新消息`,
          });
        } else if (hasOutgoingSayOnTalk(thread, w.id)) {
          out.push({
            id: w.id,
            class: w.class,
            hint: `自建 ${w.class} (target=${w.target}, 已 say 过) — 等对端回信`,
          });
        }
        // 自建但未 say 过的 peer 会话窗不算合法候选——会在错误消息里单独点名
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** 判断 thread.outbox 中是否有消息从指定 talk_window 发出过。 */
function hasOutgoingSayOnTalk(thread: ThreadContext, talkId: string): boolean {
  return (thread.outbox ?? []).some((m) => m.windowId === talkId);
}

function findWindow(thread: ThreadContext, id: string): ContextWindow | undefined {
  // 窄化：contextWindows 契约层是 base[]；narrow find 结果回 union（runtime 即 union 实例）。
  return (thread.contextWindows ?? []).find((w) => w.id === id) as ContextWindow | undefined;
}

const errorOutput = (error: string) =>
  JSON.stringify({ ok: false, tool: "wait", error });

const successOutput = (message: string, on: string) =>
  JSON.stringify({ ok: true, tool: "wait", message, on });

/** 把候选列表渲染成 LLM 可读的多行 hint。 */
function renderCandidates(candidates: WaitCandidate[]): string {
  if (candidates.length === 0) {
    return "  （无可等待来源 —— 任务大概率已完成，请改用 end method 收尾）";
  }
  return candidates.map((c) => `  - ${c.id} (${c.class}) — ${c.hint}`).join("\n");
}

export const WAIT_TOOL: LlmTool = {
  name: "wait",
  description:
    "声明你在等指定 window 上的未来 IO 事件，把当前 thread 切到 waiting。" +
    "on 必填且必须 resolve 到当前 contextWindows 里 open 状态的 talk_window" +
    "（peer 会话 / fork 子线程窗，是允许产生未来 IO 的 window）。没有合法 on 时不能 wait——" +
    "意味着任务已完成 / 无 IO 预期，请改用 end method 收尾。",
  inputSchema: {
    type: "object",
    properties: {
      title: TITLE_PARAM,
      on: {
        type: "string",
        description:
          "未来 IO 来源 window id。必须是当前 contextWindows 里 open 的 talk_window。" +
          "peer 会话窗：等对端发新消息（creator 一律合法；自建需先 say 过）。" +
          "fork 子线程窗：等子线程回报（子线程必须仍 running/waiting）。",
      },
      reason: {
        type: "string",
        description: "（可选）人类可读的等待说明，observability 用。",
      },
      mark: MARK_PARAM,
    },
    required: ["on"],
  },
};

export async function handleWaitTool(
  thread: ThreadContext,
  args: Record<string, unknown>,
): Promise<string> {
  const onRaw = args.on;
  const candidates = listValidWaitTargets(thread);

  // R5: thread 没有任何合法候选 → 强 nudge end，无论 on 给没给
  if (candidates.length === 0) {
    return errorOutput(
      "[wait] 本 thread 没有任何可等待的 IO 来源——没有 creator talk_window、" +
        "没有 open 的 fork 子线程窗、自建 talk_window 也没 say 过。\n" +
        "这意味着任务已经完成且不期望更多输入。请改用 end method 收尾：\n" +
        "  open(method=\"end\", title=\"...\", args={ summary: \"<本次工作结论>\" })",
    );
  }

  // R1: on 缺失 / 类型错
  if (typeof onRaw !== "string" || onRaw.length === 0) {
    return errorOutput(
      "[wait] 缺少必填参数 on=<window_id>，指向你正在等待事件的 window。\n" +
        "当前 thread 内可作为 IO 来源的 open windows：\n" +
        renderCandidates(candidates),
    );
  }

  const target = findWindow(thread, onRaw);

  // R2: on resolve 失败（window 不存在）
  if (!target) {
    return errorOutput(
      `[wait] on="${onRaw}" 未在当前 thread 找到对应 window。\n` +
        "可作为 IO 来源的合法候选：\n" +
        renderCandidates(candidates),
    );
  }

  // R3: on 类型不合法（非 talk / reflect_request）—— 这同时盖掉了 root/method_exec/file 等
  if (target.class !== "talk" && target.class !== "reflect_request") {
    // program window 给针对性提示:它是同步执行,结果已落在 history 里,不需要 wait
    const typeSpecificHint =
      target.class === "program"
        ? `\nprogram_window 是同步执行的:exec 提交时 runOneExec 立即跑完,输出已在该 window.history 里;不存在"运行中"状态可等。直接读 program_window 的 history 即可。`
        : "";
    return errorOutput(
      `[wait] on="${onRaw}" 指向的是 ${target.class} window，不能作为 IO 来源——` +
        "只有 talk_window（peer 等对端消息 / fork 等子线程回报）" +
        "才可被 wait 引用。" +
        typeSpecificHint +
        "\n当前合法候选：\n" +
        renderCandidates(candidates),
    );
  }

  // 类型已收窄到 talk | reflect_request；会话窗一律 alive=open。
  if (target.status !== "open") {
    const desc = target.isForkWindow ? "fork 子线程窗（子线程已结束）" : `${target.class}_window`;
    return errorOutput(
      `[wait] ${desc} "${onRaw}" 状态是 ${target.status}（非 open），不能再等它产生 IO。\n` +
        "当前合法候选：\n" +
        renderCandidates(candidates),
    );
  }

  // R4: 自建 peer 会话窗（非 creator、非 fork）且未 say 过 → 拒绝
  if (!target.isForkWindow && !target.isCreatorWindow && !hasOutgoingSayOnTalk(thread, target.id)) {
    return errorOutput(
      `[wait] talk_window "${onRaw}" (target=${target.target}) 是你自建的，` +
        "但尚未 say 过任何消息——对端不知道有人在等回信。请先发出消息再 wait：\n" +
        `  open(parent_window_id="${target.id}", method="say", title="...", args={ content: "..." })\n` +
        "或换一个已建立通讯的 window：\n" +
        renderCandidates(candidates),
    );
  }

  // Happy path
  const reason = (args.reason as string | undefined) ?? "";
  thread.status = "waiting";
  thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
  thread.waitingOn = onRaw;

  const targetDesc = target.isForkWindow
    ? `fork (target_thread=${target.targetThreadId})`
    : `creator/自建 ${target.class} (target=${target.target})`;
  const reasonSuffix = reason ? ` 原因：${reason}` : "";
  return successOutput(
    `[wait] 线程进入 waiting，等待 ${onRaw} (${targetDesc}) 上的未来 IO 事件。${reasonSuffix}`,
    onRaw,
  );
}
