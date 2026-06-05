/**
 * method_exec.refine —— 把 ctx.args 整体 merge 到 form.accumulatedArgs。
 *
 * 调用形态：exec(<form_id>, "refine", args={ msg: "..." })
 *
 * exec ctx 中：
 * - self = 该 form 自身（type=method_exec；P6.§3 由 manager dispatch 强保证类型）
 * - ctx.args = 要累积/覆盖到 form 上的键值对
 * - manager 用来调内部 refine 方法重算 commandPaths
 *
 * P6.§9（2026-06-02）：源文件从 `packages/@ooc/builtins/command_exec/executable/command.refine.ts`
 * 迁移到 `packages/@ooc/core/executable/windows/method_exec/refine.ts`。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../_shared/command-types.js";
import type { MethodExecWindow } from "../_shared/types.js";
import type { WindowManager } from "../_shared/manager.js";
import type { BaseContextWindow } from "@ooc/core/_shared";
import type { Intent } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";

async function executeRefine(ctx: MethodExecutionContext): Promise<string | undefined> {
  // P6.§3: manager 在 dispatch 阶段已保证 self.type === "method_exec"，method 体不再 re-check。
  const form = ctx.self as MethodExecWindow;
  // Round 13: 允许 open 或 failed (failed 上 refine 触发"复活"路径, 自动切回 open)
  if (form.status !== "open" && form.status !== "failed") {
    return `[method_exec.refine] form ${form.id} 不在 open / failed 状态（当前 ${form.status}）, 无法 refine。`;
  }
  const incoming = ctx.args;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return "[method_exec.refine] 缺少 args 对象（业务参数键值对）。";
  }
  if (Object.keys(incoming).length === 0) {
    return "[method_exec.refine] 收到空 args（{}）。要么填上至少一个键值对，要么直接 exec(form_id, \"submit\")。";
  }
  if (!ctx.manager) {
    return "[method_exec.refine] 缺少 manager 上下文。";
  }
  // batch C narrowing(N2): ctx.manager 契约层是 unknown，narrow 回 WindowManager（已过 null 检查）。
  const manager = ctx.manager as WindowManager;
  const ok = manager.refine(form.id, incoming);
  if (!ok) {
    return `[method_exec.refine] refine 失败：form ${form.id} 不存在或不在 open / failed 状态。`;
  }
  // P6.§8 (2026-06-02): refine mutates accumulated args (form is a builtin feature →
  // its state lives inline in the thread's thread-context.json); flush so the on-disk
  // snapshot reflects the edit immediately. Fixes "refine 不写盘" in the plan.
  await ctx.reportContextEdit?.();
  const updated = manager.get(form.id);
  const paths = updated && updated.type === "method_exec" ? updated.commandPaths.join(", ") : "";
  // Round 13: 如果是从 failed 复活, 标注一下让 LLM 知道 form 已切回 open。
  const revived = form.status === "failed" ? "（form 从 failed 复活, 已切回 open, 可 submit）" : "";
  return `Form ${form.id} 已累积参数${revived}。当前路径：${paths}。`;
}

function guidanceWindows(form: BaseContextWindow, entries: Record<string, string>): ContextWindow[] {
  // batch C narrowing(N3): form 契约层是 base ContextWindow；只读 base id + 具体 form 的 command，narrow 一次。
  const sourceId = (form as MethodExecWindow).command;
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

export const refineMethod: ObjectMethod = {
  paths: ["refine"],
  intent: (): Intent[] => [],
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return guidanceWindows(form, {
      "internal/windows/method_exec/refine/basic": [
        "method_exec.refine 用于向 form 累积参数；ctx.args 整体作为要累积的键值对。",
        "调用：exec(window_id=<form_id>, command=\"refine\", args={ <要累积的键值对> })",
        "多次调用会叠加；填齐参数后用 exec(form_id, \"submit\") 触发执行。",
        "Round 13: refine 也接受 status=failed 的 form (submit 失败后); 调 refine 会自动把 form 切回 open + 清旧 result, 可重 submit。这是首选的失败修复路径 (保留 form 上下文)。",
      ].join("\n"),
    });
  },
  exec: (ctx) => executeRefine(ctx),
};

