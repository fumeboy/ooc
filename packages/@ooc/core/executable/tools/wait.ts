/**
 * wait tool — 显式声明"等指定 window 上的未来 IO 事件"，把 thread 切到 waiting。
 *
 * spec: docs/superpowers/specs/2026-05-17-wait-requires-dependency-design.md
 *
 * - `on` 必填：必须 resolve 到当前 contextWindows 一个 open 且可产生未来 IO 的 window
 *   （talk_window / do_window）。
 * - 没有任何合法 `on` 候选时 → reject，强 nudge 改 end method。
 * - thread.inboxSnapshotAtWait 仍用于 wakeup（Phase 1 wakeup 逻辑不变）；
 *   thread.waitingOn 仅作 observability，不参与 wakeup 决策。
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import type { ContextWindow } from "../windows/_shared/types.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

interface WaitCandidate {
  id: string;
  class: "talk" | "do";
  hint: string;
}

/** open/可作为未来 IO 来源的 window 列表，附 hint 帮 LLM 自纠时选对。 */
function listValidWaitTargets(thread: ThreadContext): WaitCandidate[] {
  const out: WaitCandidate[] = [];
  // 窄化：contextWindows 契约层是 base[]；narrow 回 union[]，
  // switch(w.class) 才能 discriminant-narrow 到 TalkWindow / DoWindow 读 isCreatorWindow/target/targetThreadId。
  for (const w of (thread.contextWindows ?? []) as ContextWindow[]) {
    // 每种 window 的"alive"状态不同——talk=open，do=running
    switch (w.class) {
      case "talk": {
        if (w.status !== "open") break;
        if (w.isCreatorWindow) {
          out.push({
            id: w.id,
            class: "talk",
            hint: `creator talk (target=${w.target}) — 等创建者发新消息`,
          });
        } else if (hasOutgoingSayOnTalk(thread, w.id)) {
          out.push({
            id: w.id,
            class: "talk",
            hint: `自建 talk (target=${w.target}, 已 say 过) — 等对端回信`,
          });
        }
        // 自建但未 say 过的 talk 不算合法候选——会在错误消息里单独点名
        break;
      }
      case "do": {
        if (w.status !== "running") break;
        out.push({
          id: w.id,
          class: "do",
          hint: `do (target_thread=${w.targetThreadId}) — 等子线程回报`,
        });
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
    "on 必填且必须 resolve 到当前 contextWindows 里 open 状态的 talk_window / do_window" +
    "（这是允许产生未来 IO 的两种 window type）。没有合法 on 时不能 wait——" +
    "意味着任务已完成 / 无 IO 预期，请改用 end method 收尾。",
  inputSchema: {
    type: "object",
    properties: {
      title: TITLE_PARAM,
      on: {
        type: "string",
        description:
          "未来 IO 来源 window id。必须是当前 contextWindows 里 open 的 talk_window / do_window。" +
          "talk_window：等对端发新消息（creator talk 一律合法；自建 talk 需先 say 过）。" +
          "do_window：等子线程 outbox 回报（子线程必须仍 running/waiting）。",
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
        "没有 open 的 do_window、自建 talk_window 也没 say 过。\n" +
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

  // R3: on 类型不合法（非 talk / 非 do）—— 这同时盖掉了 root/method_exec/file 等
  if (target.class !== "talk" && target.class !== "do") {
    // program window 给针对性提示:它是同步执行,结果已落在 history 里,不需要 wait
    const typeSpecificHint =
      target.class === "program"
        ? `\nprogram_window 是同步执行的:exec 提交时 runOneExec 立即跑完,输出已在该 window.history 里;不存在"运行中"状态可等。直接读 program_window 的 history 即可。`
        : "";
    return errorOutput(
      `[wait] on="${onRaw}" 指向的是 ${target.class} window，不能作为 IO 来源——` +
        "只有 talk_window（等对端消息）/ do_window（等子线程回报）" +
        "两种 window 才可被 wait 引用。" +
        typeSpecificHint +
        "\n当前合法候选：\n" +
        renderCandidates(candidates),
    );
  }

  // 类型已收窄到 talk | do。各自的"alive"状态不同，分别校验
  if (target.class === "talk" && target.status !== "open") {
    return errorOutput(
      `[wait] talk_window "${onRaw}" 状态是 ${target.status}（非 open），不能再等它产生 IO。\n` +
        "当前合法候选：\n" +
        renderCandidates(candidates),
    );
  }
  if (target.class === "do" && target.status !== "running") {
    return errorOutput(
      `[wait] do_window "${onRaw}" 状态是 ${target.status}（非 running），子线程已结束。\n` +
        "当前合法候选：\n" +
        renderCandidates(candidates),
    );
  }

  // R4: 自建（非 creator）talk_window 且未 say 过 → 拒绝
  if (target.class === "talk" && !target.isCreatorWindow && !hasOutgoingSayOnTalk(thread, target.id)) {
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

  const targetDesc =
    target.class === "talk"
      ? `creator/自建 talk (target=${target.target})`
      : `do (target_thread=${target.targetThreadId})`;
  const reasonSuffix = reason ? ` 原因：${reason}` : "";
  return successOutput(
    `[wait] 线程进入 waiting，等待 ${onRaw} (${targetDesc}) 上的未来 IO 事件。${reasonSuffix}`,
    onRaw,
  );
}
