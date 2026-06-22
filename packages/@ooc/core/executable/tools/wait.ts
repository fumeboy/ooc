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
import type { OocObjectRef, OocObjectInstance } from "../../runtime/ooc-class.js";
import type { TalkData } from "@ooc/builtins/agent/thread/types.js";
import { THREAD_CLASS_ID } from "../../_shared/types/constants.js";
import { isSelfThreadWindow, objectDataOf, classOf } from "../../_shared/types/context-window.js";
import { getSessionObjectTable } from "../../runtime/session-object-table.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

interface WaitCandidate {
  id: string;
  hint: string;
}

/** 从实例读 talk 业务数据（Wave 4：业务字段落 inst.data=TalkData，经对象表解析）。 */
function talkDataOf(w: OocObjectRef, table: Map<string, OocObjectInstance>): Partial<TalkData> {
  return (objectDataOf(w, table) ?? {}) as Partial<TalkData>;
}

/** open/可作为未来 IO 来源的 window 列表，附 hint 帮 LLM 自纠时选对。 */
function listValidWaitTargets(thread: ThreadContext): WaitCandidate[] {
  const out: WaitCandidate[] = [];
  const table = getSessionObjectTable(thread);
  // contextWindows 是 OocObjectRef[]：会话窗 inst.class 一律 = `_builtin/thread`（唯一会话载体
  // 注册 class）；isForkWindow/target/targetThreadId 从 inst.data 读，creator 窗身份按 id 派生
  // （isSelfThreadWindow）。
  for (const w of thread.contextWindows ?? []) {
    // 会话窗（thread 实例：creator / peer / fork）= 唯一可产生未来 IO 的 window；alive=open。
    if (classOf(w) !== THREAD_CLASS_ID) continue;
    if (w.status !== "open") continue;
    const d = talkDataOf(w, table);
    if (d.isForkWindow) {
      // fork 子线程窗：等子线程（或父线程，creator fork 窗）回报。
      out.push({
        id: w.id,
        hint: `fork (target_thread=${d.targetThreadId}) — 等${isSelfThreadWindow(w.id) ? "父" : "子"}线程回报`,
      });
    } else if (isSelfThreadWindow(w.id) && d.target != null) {
      out.push({
        id: w.id,
        hint: `creator talk_window (target=${d.target}) — 等创建者发新消息`,
      });
    } else if (hasOutgoingSayOnTalk(thread, w.id)) {
      out.push({
        id: w.id,
        hint: `自建 talk_window (target=${d.target}, 已 say 过) — 等对端回信`,
      });
    }
    // 自建但未 say 过的 peer 会话窗不算合法候选——会在错误消息里单独点名
  }
  return out;
}

/** 判断 thread.outbox 中是否有消息从指定 talk_window 发出过。 */
function hasOutgoingSayOnTalk(thread: ThreadContext, talkId: string): boolean {
  return (thread.outbox ?? []).some((m) => m.windowId === talkId);
}

function findWindow(thread: ThreadContext, id: string): OocObjectRef | undefined {
  return (thread.contextWindows ?? []).find((w) => w.id === id);
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
  return candidates.map((c) => `  - ${c.id} (talk_window) — ${c.hint}`).join("\n");
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

  // R3: on 类型不合法（非会话窗）—— 会话窗 inst.class 一律 = `_builtin/thread`；同时盖掉
  // root/method_exec/file/process 等非会话窗。
  if (classOf(target) !== THREAD_CLASS_ID) {
    // 进程 window 给针对性提示:它是同步执行,结果已落在 history 里,不需要 wait
    const targetClass = classOf(target);
    const typeSpecificHint =
      targetClass === "terminal_process" || targetClass === "interpreter_process"
        ? `\n${targetClass} 是同步执行的:exec 提交时立即跑完,输出已在该 window.history 里;不存在"运行中"状态可等。直接读它的 history 即可。`
        : "";
    return errorOutput(
      `[wait] on="${onRaw}" 指向的是 ${targetClass} window，不能作为 IO 来源——` +
        "只有 talk_window（peer 等对端消息 / fork 等子线程回报）" +
        "才可被 wait 引用。" +
        typeSpecificHint +
        "\n当前合法候选：\n" +
        renderCandidates(candidates),
    );
  }

  const targetData = talkDataOf(target, getSessionObjectTable(thread));

  // 已收窄到会话窗（inst.class=`_builtin/thread`）；会话窗一律 alive=open。
  if (target.status !== "open") {
    const desc = targetData.isForkWindow ? "fork 子线程窗（子线程已结束）" : "talk_window";
    return errorOutput(
      `[wait] ${desc} "${onRaw}" 状态是 ${target.status}（非 open），不能再等它产生 IO。\n` +
        "当前合法候选：\n" +
        renderCandidates(candidates),
    );
  }

  // R4: 非合法 IO 源 → 拒绝。合法 = fork 窗 / 有上游 creator 通道的 thread 窗 / 已 say 过的自建 peer。
  // 空通道 thread 窗（self-driven root 的过程窗）isSelfThreadWindow 为真但无 target → 不是 IO 源、须拒（防死锁）。
  if (!targetData.isForkWindow && !(isSelfThreadWindow(target.id) && targetData.target != null) && !hasOutgoingSayOnTalk(thread, target.id)) {
    return errorOutput(
      `[wait] talk_window "${onRaw}" (target=${targetData.target}) 是你自建的，` +
        "但尚未 say 过任何消息——对端不知道有人在等回信。请先发出消息再 wait：\n" +
        `  open(parent_window_id="${target.id}", method="say", title="...", args={ msg: "..." })\n` +
        "或换一个已建立通讯的 window：\n" +
        renderCandidates(candidates),
    );
  }

  // Happy path
  const reason = (args.reason as string | undefined) ?? "";
  thread.status = "waiting";
  thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
  thread.waitingOn = onRaw;

  const targetDesc = targetData.isForkWindow
    ? `fork (target_thread=${targetData.targetThreadId})`
    : `creator/自建 talk_window (target=${targetData.target})`;
  const reasonSuffix = reason ? ` 原因：${reason}` : "";
  return successOutput(
    `[wait] 线程进入 waiting，等待 ${onRaw} (${targetDesc}) 上的未来 IO 事件。${reasonSuffix}`,
    onRaw,
  );
}
