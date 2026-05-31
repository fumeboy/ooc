/**
 * wait tool — 显式声明"等指定来源上的未来 IO 事件"，把 thread 切到 waiting。
 *
 * spec: docs/superpowers/specs/2026-05-17-wait-requires-dependency-design.md
 * OOC-4 L5c（talk 塌缩）：agent 不再持有自建 talk_window；等某 peer 回信改为按 talks.json
 * peer objectId 指定（`on=<peerObjectId>`）。
 * OOC-4 L6b（do 塌缩）：do_window 已 render-skip；等子线程改按**子线程 id**（childThreadId）指定
 * （`on=<childThreadId>`，子线程须 running）。仍兼容 creator talk_window（callee thread 自带、
 * 指向 caller，`on=<window id>`）。
 *
 * - `on` 必填：必须 resolve 到合法来源（子线程 id / creator talk_window id / talks.json peer id）。
 * - 没有任何合法 `on` 候选时 → reject，强 nudge 改 end method。
 * - thread.inboxSnapshotAtWait 仍用于 wakeup；thread.waitingOn 仅作 observability，不参与 wakeup 决策。
 *
 * **典型路径**：要给某 peer 发消息并等回信，优先用 `talk(target, content, wait:true)` 一步合一，
 * 不需要先 talk 再单独 wait。`wait` 工具用于：等子线程（on=<childThreadId>）、等 creator 发新消息、
 * 等某已开会话 peer 的下一条回信（按 peer objectId）。
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import type { ContextWindow } from "../windows/_shared/types.js";
import { readTalks, type FlowObjectRef } from "../../persistable/index.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

interface WaitCandidate {
  /** 候选 id：do 子线程 id（childThreadId）/ creator talk_window id / talks.json peer objectId。 */
  id: string;
  kind: "talk-window" | "talk-peer" | "do";
  hint: string;
}

/** 从 thread.persistence 派生对象级 FlowObjectRef；缺 objectId 返回 undefined。 */
function flowRefOf(thread: ThreadContext): FlowObjectRef | undefined {
  const ref = thread.persistence;
  if (!ref?.objectId) return undefined;
  return { baseDir: ref.baseDir, sessionId: ref.sessionId, objectId: ref.objectId, stonesBranch: ref.stonesBranch };
}

/**
 * 合法 IO 来源候选列表（附 hint 帮 LLM 自纠时选对）：
 * - do 子线程（running，非 creator）：等子线程回报，按子线程 id（childThreadId）。
 * - creator talk_window（仍存在）：等创建者发新消息，按 window id。
 * - talks.json peer：已与某 peer 开过会话，等该 peer 下一条回信，按 peer objectId。
 */
async function listValidWaitTargets(thread: ThreadContext): Promise<WaitCandidate[]> {
  const out: WaitCandidate[] = [];

  // 1) window 来源：do 子线程（running）/ creator talk_window（仍存在）。
  for (const w of thread.contextWindows ?? []) {
    switch (w.type) {
      case "do": {
        // OOC-4 L6b：do_window 已 render-skip；wait 候选改按子线程 id（childThreadId=targetThreadId）。
        // 仅非 creator 的 do_window（parent 侧，等子线程回报）；creator do_window 是 child 侧
        // 回报口（do_continue(target=parent)），不作 wait child 用。
        if (w.status !== "running" || w.isCreatorWindow) break;
        out.push({
          id: w.targetThreadId,
          kind: "do",
          hint: `child=${w.targetThreadId} — 等子线程回报`,
        });
        break;
      }
      case "talk": {
        // agent 已不自建 talk_window；仍存在的只有 creator talk_window（指向 caller）。
        if (w.status !== "open") break;
        if (w.isCreatorWindow) {
          out.push({
            id: w.id,
            kind: "talk-window",
            hint: `creator talk (peer=${w.target}) — 等创建者发新消息`,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  // 2) talks.json peer 来源：与某 peer 已开过会话，等其下一条回信（按 peer objectId）。
  const ref = flowRefOf(thread);
  if (ref) {
    try {
      const routing = await readTalks(ref);
      for (const [peer, route] of Object.entries(routing)) {
        if (!route?.targetThreadId) continue;
        out.push({
          id: peer,
          kind: "talk-peer",
          hint: `peer=${peer}（已开会话）— 等该 peer 回信`,
        });
      }
    } catch {
      // talks.json 读失败（损坏等）不致命：仅退化为 window 来源。
    }
  }

  return out;
}

function findWindow(thread: ThreadContext, id: string): ContextWindow | undefined {
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
  return candidates.map((c) => `  - ${c.id} (${c.kind}) — ${c.hint}`).join("\n");
}

export const WAIT_TOOL: LlmTool = {
  name: "wait",
  description:
    "声明你在等指定来源上的未来 IO 事件，把当前 thread 切到 waiting。" +
    "on 必填且必须 resolve 到合法来源：子线程 id（等子线程回报）/ creator talk_window id（等创建者）/ " +
    "talks.json peer objectId（等已开会话的某 peer 回信）。没有合法 on 时不能 wait——" +
    "意味着任务已完成 / 无 IO 预期，请改用 end method 收尾。" +
    "提示：要给某 peer 发消息并等回信，优先用 talk(target,content,wait:true) 一步合一。",
  inputSchema: {
    type: "object",
    properties: {
      title: TITLE_PARAM,
      on: {
        type: "string",
        description:
          "未来 IO 来源。可为：子线程 id（你 do 出来的子线程，必须仍 running，见 <self_view><active_children>）；" +
          "creator talk_window id；或 talks.json 里已开会话的 peer objectId（等该 peer 回信）。",
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
  const candidates = await listValidWaitTargets(thread);

  // R5: thread 没有任何合法候选 → 强 nudge end，无论 on 给没给
  if (candidates.length === 0) {
    return errorOutput(
      "[wait] 本 thread 没有任何可等待的 IO 来源——没有进行中的子线程、" +
        "没有 creator talk_window、talks.json 里也没有已开会话的 peer。\n" +
        "这意味着任务已经完成且不期望更多输入。请改用 end method 收尾：\n" +
        "  exec(method=\"end\", title=\"...\", args={ summary: \"<本次工作结论>\" })",
    );
  }

  // R1: on 缺失 / 类型错
  if (typeof onRaw !== "string" || onRaw.length === 0) {
    return errorOutput(
      "[wait] 缺少必填参数 on，指向你正在等待事件的来源。\n" +
        "当前合法候选：\n" +
        renderCandidates(candidates),
    );
  }

  // 先尝试按 talks.json peer 匹配（peer objectId 命名空间与 window id 不冲突）。
  const peerCandidate = candidates.find((c) => c.kind === "talk-peer" && c.id === onRaw);
  if (peerCandidate) {
    return enterWaiting(thread, onRaw, args, `talk peer=${onRaw}`);
  }

  // OOC-4 L6b：do 子线程按子线程 id（childThreadId）匹配——do_window 已 render-skip，
  // 不再按 window id 寻址。
  const doCandidate = candidates.find((c) => c.kind === "do" && c.id === onRaw);
  if (doCandidate) {
    return enterWaiting(thread, onRaw, args, `do child=${onRaw}`);
  }

  const target = findWindow(thread, onRaw);

  // R2: on resolve 失败（既非 window 也非已知 peer / 子线程）
  if (!target) {
    return errorOutput(
      `[wait] on="${onRaw}" 未匹配到任何 window、已开会话的 peer 或进行中的子线程。\n` +
        "合法候选：\n" +
        renderCandidates(candidates),
    );
  }

  // R3: on 指向 window，但类型不合法（非 talk / 非 do）—— 盖掉 root/command_exec/file 等
  if (target.type !== "talk" && target.type !== "do") {
    const typeSpecificHint =
      target.type === "program"
        ? `\nprogram_window 是同步执行的:exec 提交时 runOneExec 立即跑完,输出已在该 window.history 里;不存在"运行中"状态可等。直接读 program_window 的 history 即可。`
        : "";
    return errorOutput(
      `[wait] on="${onRaw}" 指向的是 ${target.type} window，不能作为 IO 来源——` +
        "只有子线程 id（等子线程）/ creator talk_window（等创建者）/ talks.json peer（等回信）" +
        "可被 wait 引用。" +
        typeSpecificHint +
        "\n当前合法候选：\n" +
        renderCandidates(candidates),
    );
  }

  // 类型已收窄到 talk | do。各自的"alive"状态不同，分别校验
  if (target.type === "talk" && target.status !== "open") {
    return errorOutput(
      `[wait] talk_window "${onRaw}" 状态是 ${target.status}（非 open），不能再等它产生 IO。\n` +
        "当前合法候选：\n" +
        renderCandidates(candidates),
    );
  }
  if (target.type === "do") {
    // OOC-4 L6b：do_window 已 render-skip 且改按子线程 id 寻址。
    // - archived（子线程已结束）→ 沿用原 reject 文案（archived / 非 running）。
    // - running 却被按 window id 传入 → 指引改用子线程 id（childThreadId=targetThreadId）。
    if (target.status !== "running") {
      return errorOutput(
        `[wait] do_window "${onRaw}" 状态是 ${target.status}（非 running），子线程已结束。\n` +
          "当前合法候选：\n" +
          renderCandidates(candidates),
      );
    }
    return errorOutput(
      `[wait] do 子线程改用子线程 id 等待（不再按 do_window id）。请用 on="${target.targetThreadId}"：\n` +
        renderCandidates(candidates),
    );
  }

  // R4: talk_window 但非 creator —— agent 已不应持有自建 talk_window；指引改用 peer wait
  if (target.type === "talk" && !target.isCreatorWindow) {
    return errorOutput(
      `[wait] talk_window "${onRaw}" (peer=${target.target}) 不是 creator window，` +
        "无法作为 wait 来源。要等某 peer 回信，请用 on=<peer objectId>：\n" +
        renderCandidates(candidates),
    );
  }

  return enterWaiting(thread, onRaw, args, `creator talk (peer=${target.target})`);
}

/** Happy path：进 waiting，写 inboxSnapshotAtWait + waitingOn（observability）。 */
function enterWaiting(
  thread: ThreadContext,
  on: string,
  args: Record<string, unknown>,
  targetDesc: string,
): string {
  const reason = (args.reason as string | undefined) ?? "";
  thread.status = "waiting";
  thread.inboxSnapshotAtWait = thread.inbox?.length ?? 0;
  thread.waitingOn = on;
  const reasonSuffix = reason ? ` 原因：${reason}` : "";
  return successOutput(
    `[wait] 线程进入 waiting，等待 ${on} (${targetDesc}) 上的未来 IO 事件。${reasonSuffix}`,
    on,
  );
}
