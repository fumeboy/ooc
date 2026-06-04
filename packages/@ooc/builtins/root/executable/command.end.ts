import type { MethodExecutionContext, ObjectMethod } from "@ooc/core/extendable/_shared/command-types.js";
import type { ContextWindow, DoWindow, TalkWindow } from "@ooc/core/extendable/_shared/types.js";
import { continueCommand } from "@ooc/core/executable/windows/do/command.continue.js";
import { sayCommand } from "@ooc/core/executable/windows/talk/command.say.js";
import { notifyThreadActivated } from "@ooc/core/observable/index.js";
import type { Intent, MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";

/** end command 暴露给 LLM 的知识说明。 */
const KNOWLEDGE = `
end 用于显式结束当前线程，表示当前目标已经完成或不再继续推进。

参数说明：
- reason: 可选，结束原因，例如 done / cancelled / blocked
- summary: 可选，需要沉淀的最终产物或结论（写入 thread.endSummary，不会回流父线程）
- result: 可选，**便捷糖**。若提供，end 在标记 thread done 之前会**模拟在你的 creator
  window 上调一次 continue / say**，把 result 文本作为最后一条消息回报给父线程，
  并把 creator do_window 状态切到 archived。
  - 注意：**result 不是回报通道**——它只是"end 之前自动追加一条 continue/say"的语法糖。
    多段对话 / 复杂状态汇报，请显式走 \`creator_do_window.continue\` 或
    \`creator_talk_window.say\`，不要试图通过 result 传递结构化数据。
  - creator window 不存在（self-driven root）时，result 被忽略并 console.warn——
    不静默吞，但也不阻断 end。

调用示例：
open(type="command", command="end", description="结束当前线程")
refine(form_id, { reason: "done", summary: "commands 的 KNOWLEDGE 已补齐，测试通过" })
submit(form_id)

带 result（子线程把最终结果带回父）：
open(type="command", command="end", args={ reason: "done", result: "分析完成：见 memo/x.md" })
`;

const END_BASIC_PATH = "internal/executable/end/basic";

function guidanceWindows(form: MethodExecWindow, entries: Record<string, string>): ContextWindow[] {
  const out: ContextWindow[] = [];
  for (const [path, text] of Object.entries(entries)) {
    const safe = path.replace(/[^a-zA-Z0-9_]/g, "_");
    out.push({
      id: "guidance_" + form.id + "_" + safe,
      type: "guidance",
      parentWindowId: form.id,
      boundFormId: form.id,
      title: path,
      status: "open",
      createdAt: 0,
      relevance: { score: 0.8, signalCount: 1 },
      provenance: {
        kind: "derived",
        reason: { mechanism: "form_bound", sourceId: form.command },
        createdAt: 0,
        lastTouchedAt: 0,
      },
      content: text,
      summary: text.length > 200 ? text.slice(0, 200) + "..." : text,
    } as ContextWindow);
  }
  return out;
}

/** end command 的可匹配路径集合。 */
export enum EndCommandPath {
  /** 基础 end 指令：标记当前线程完成。 */
  End = "end",
}

/** end command 表项：当前只命中基础 end 路径。 */
export const endCommand: ObjectMethod = {
  paths: [EndCommandPath.End],
  schema: {
    args: {
      reason: { type: "string", required: false, description: "结束原因，例如 done / cancelled / blocked" },
      summary: { type: "string", required: false, description: "需要沉淀的最终产物或结论（写入 thread.endSummary）" },
      result: { type: "string", required: false, description: "便捷糖：end 之前模拟在 creator window 上调一次 continue/say 回报父线程" },
    },
  } as MethodCallSchema,
  intent: (): Intent[] => [],
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const entries: Record<string, string> = {
      [END_BASIC_PATH]: KNOWLEDGE.trim(),
    };
    return guidanceWindows(form, entries);
  },
  exec: (ctx) => executeEndCommand(ctx),
};

/**
 * 找到当前 thread 的 creator window（isCreatorWindow=true）。
 *
 * 当前 init.ts 规则：do/talk window 才可能带 isCreatorWindow=true。其它类型即使设置了
 * 该字段也不视为合法 creator（防御）。
 */
function findCreatorWindow(ctx: MethodExecutionContext): DoWindow | TalkWindow | undefined {
  const list = ctx.thread?.contextWindows ?? [];
  for (const w of list) {
    if ((w.type === "do" || w.type === "talk") && w.isCreatorWindow === true) {
      return w;
    }
  }
  return undefined;
}

/**
 * 在 creator do_window 上模拟一次 continue（与 LLM 同构的命令路径，不直接 mutate state）：
 * 调 continueCommand.exec 把 result 写入子→父 transcript，然后把 creator window 状态
 * 切到 archived（auto-archive 触发器）。
 *
 * 不抛错：continue 内部失败时返回 string，我们把它附到 thread.events 让父/调用方可见，
 * 但不阻断 end 流程（end 是终结动作，不应因为汇报失败回滚）。
 */
async function autoReplyAndArchiveDo(
  ctx: MethodExecutionContext,
  creator: DoWindow,
  result: string,
): Promise<void> {
  const thread = ctx.thread!;
  // 构造一个与 LLM 调用同构的 ctx：self = creator do_window（2026-06-02 P6.§1 字段从 self 改名）
  const continueCtx: MethodExecutionContext = {
    thread,
    self: creator,
    manager: ctx.manager,
    args: { msg: result },
  };
  const outcome = await continueCommand.exec(continueCtx);
  if (typeof outcome === "string" && outcome.length > 0) {
    // 失败信息 explicit 写入 events（silent-swallow ban）
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[end.result] 自动 reply 到 creator do_window 失败：${outcome}`,
    });
    return;
  }
  // auto-archive：creator window status 切到 archived（DoWindow.status union 已含 archived）
  // 注意：直接 mutate window 字段；WindowManager.submit 在 entry.exec 完成后会 toData 重写
  // contextWindows——这里在同一轮 entry.exec 内 mutate 仍有效（与 do command 的做法一致）。
  const list = thread.contextWindows;
  const idx = list.findIndex((w: ContextWindow) => w.id === creator.id);
  if (idx >= 0) {
    const target = list[idx]!;
    if (target.type === "do") {
      list[idx] = { ...target, status: "archived" };
    }
  }
}

/**
 * 在 creator talk_window 上模拟一次 say：调 sayCommand.exec 派送给 caller。
 *
 * talk_window 无 archived 状态（status: open|closed），不做"auto-archive"——
 * talk 是恒在通道，自然由 caller / callee 各自 lifecycle 释放。
 */
async function autoReplyTalk(
  ctx: MethodExecutionContext,
  creator: TalkWindow,
  result: string,
): Promise<void> {
  const thread = ctx.thread!;
  const sayCtx: MethodExecutionContext = {
    thread,
    self: creator,
    manager: ctx.manager,
    args: { msg: result },
  };
  const outcome = await sayCommand.exec(sayCtx);
  if (typeof outcome === "string" && outcome.length > 0) {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[end.result] 自动 reply 到 creator talk_window 失败：${outcome}`,
    });
  }
}

/**
 * 执行 end command：记录结束信息；如有 result，先在 creator window 上 reply 再标记 thread done。
 *
 * result 参数语义（2026-05-24 dogfooding 闭环修复 / root cause #1）：
 * - 是"end 之前自动调一次 creator window.continue/say"的便捷糖
 * - 子→父回报真正的通道仍是 creator window，end({result}) 只是 1-shot 简化
 * - creator window 不存在时 result 被忽略并 console.warn（不静默吞）
 *
 * 状态翻转顺序：先 reply（可能失败但不阻断）→ 写 endReason/endSummary → status=done。
 */
export async function executeEndCommand(ctx: MethodExecutionContext): Promise<string | undefined> {
  if (!ctx.thread) return undefined;

  const reason = typeof ctx.args.reason === "string" ? ctx.args.reason : undefined;
  const summary = typeof ctx.args.summary === "string" ? ctx.args.summary : undefined;
  const result = typeof ctx.args.result === "string" && ctx.args.result.length > 0
    ? ctx.args.result
    : undefined;

  if (result !== undefined) {
    const creator = findCreatorWindow(ctx);
    if (!creator) {
      // 不静默吞（silent-swallow ban）；同时写一条 inject 让 LLM 这一轮自己也看到
      console.warn(
        `[end.result] thread ${ctx.thread.id} 无 creator window（self-driven root？），result 被忽略：${result.slice(0, 100)}${result.length > 100 ? "..." : ""}`,
      );
      ctx.thread.events.push({
        category: "context_change",
        kind: "inject",
        text: "[end.result] 当前 thread 无 creator window（self-driven root），result 参数被忽略；仅 endSummary 仍会记录。",
      });
    } else if (creator.type === "do") {
      await autoReplyAndArchiveDo(ctx, creator, result);
    } else {
      await autoReplyTalk(ctx, creator, result);
    }
  }

  ctx.thread.endReason = reason;
  ctx.thread.endSummary = summary;
  ctx.thread.status = "done";

  // 根因 #5：callee 结束时通知 creator thread，确保 caller 即使在 waiting
  // 也能被 worker 调度。
  //
  // `result` 路径已经通过 continue/say → deliverTalkMessage 内部 notify 过 caller；
  // 这里**无条件**再调一次：notifyThreadActivated 由 jobManager.createRunThreadJob 去重，
  // 多次调用幂等。这覆盖 end({}) 不带 result 的常见路径。
  //
  // C5（2026-05-25）：cross-session 修复 — 优先使用 thread.creatorSessionId（由 talk-delivery
  // 在跨 session 创建 callee 时写入），fallback 到 callee 自身的 persistence.sessionId。
  // 这解决了 super-alias 场景下 callee 在 super session、caller 在 user session 时
  // notify 派错 session、jobManager 找不到 thread → job failed 的 caveat。
  // syncCrossObjectCalleeEnds 仍是后备 fallback（不依赖 notify 但 latency 高），保持兼容。
  const persistence = ctx.thread.persistence;
  if (persistence) {
    const creator = findCreatorWindow(ctx);
    if (creator) {
      const callerObjectId =
        creator.type === "do" ? persistence.objectId : creator.target;
      const callerThreadId =
        creator.type === "do" ? (creator as DoWindow).targetThreadId : (creator as TalkWindow).targetThreadId;
      // C5: 优先 creatorSessionId（cross-session），fallback persistence.sessionId（同 session）
      const callerSessionId = ctx.thread.creatorSessionId ?? persistence.sessionId;
      if (callerObjectId && callerThreadId && callerObjectId !== "user") {
        notifyThreadActivated({
          sessionId: callerSessionId,
          objectId: callerObjectId,
          threadId: callerThreadId,
        });
      }
    }
  }
  return undefined;
}
