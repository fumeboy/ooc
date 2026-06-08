/**
 * method_exec.submit —— 触发 form.method.exec。
 *
 * 调用形态：exec(<form_id>, "submit")
 *
 * exec ctx 中：
 * - self = 该 form 自身（type=method_exec；P6.§3 由 manager dispatch 强保证类型）
 * - ctx.thread / ctx.manager 是必需的
 *
 * 命令体走 manager.submit：状态 open → executing → success | failed (Round 13 升级)。
 * 成功 (success) 自动移除 form；失败 (failed) 保留 form + result，LLM 可 refine 修复后重 submit。
 *
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../_shared/method-types.js";
import type { MethodExecWindow } from "../_shared/types.js";
import type { WindowManager } from "../_shared/manager.js";
import type { BaseContextWindow } from "@ooc/core/_shared";
import type { Intent } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";

async function executeSubmit(ctx: MethodExecutionContext): Promise<string | undefined> {
  // P6.§3: manager 在 dispatch 阶段已保证 self.type === "method_exec"，method 体不再 re-check。
  const form = ctx.self as MethodExecWindow;
  if (form.status !== "open") {
    return `[method_exec.submit] form ${form.id} 不在 open 状态（当前 ${form.status}）。`;
  }
  if (!ctx.manager || !ctx.thread) {
    return "[method_exec.submit] 缺少 manager / thread 上下文。";
  }
  // batch C narrowing(N2): ctx.manager 契约层是 unknown，narrow 回 WindowManager（已过 null 检查）。
  const manager = ctx.manager as WindowManager;
  try {
    const result = await manager.submit(form.id, ctx.thread);
    const after = manager.get(form.id);
    const removed = !after;
    const title = form.method;
    // Round 13: removed = success 路径 (form 已自动从 contextWindows 移除);
    // 留下来的必然是 failed 状态 (open → executing → failed)。
    const messageBase = removed
      ? `[form success] form "${title}" 已成功执行并自动释放。`
      : `[form failed] form "${title}" 执行失败（status=failed; refine 修正参数后可重 submit, 或 close 放弃）。`;
    return result !== undefined ? `${messageBase}\n${result}` : messageBase;
  } catch (err) {
    return `[method_exec.submit] submit 失败：${(err as Error).message}`;
  }
}

function guidanceWindows(form: BaseContextWindow, entries: Record<string, string>): ContextWindow[] {
  // batch C narrowing(N3): form 契约层是 base ContextWindow；只读 base id + 具体 form 的 method，narrow 一次。
  const sourceId = (form as MethodExecWindow).method;
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
        reason: { mechanism: "form_bound", sourceId },
        createdAt: 0,
        lastTouchedAt: 0,
      },
      content: text,
      summary: text.length > 200 ? text.slice(0, 200) + "..." : text,
    } as ContextWindow);
  }
  return out;
}

export const submitMethod: ObjectMethod = {
  paths: ["submit"],
  intent: (): Intent[] => [],
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return guidanceWindows(form, {
      "internal/windows/method_exec/submit/basic": [
        "method_exec.submit 触发 form.method 真正执行；不接受新业务参数。",
        "调用：exec(window_id=<form_id>, method=\"submit\")",
        "成功执行后系统自动从 context 移除该 form；失败则保留 result 字段，需要 close。",
      ].join("\n"),
    });
  },
  exec: (ctx) => executeSubmit(ctx),
};

