/**
 * method_exec.refine —— 把 ctx.args 整体 merge 到 form.accumulatedArgs。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../_shared/method-types.js";
import type { MethodExecWindow } from "../_shared/types.js";
import type { WindowManager } from "../_shared/manager.js";

async function executeRefine(ctx: MethodExecutionContext): Promise<string | undefined> {
  const form = ctx.self as MethodExecWindow;
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
  const manager = ctx.manager as WindowManager;
  const ok = await manager.refine(form.id, incoming);
  if (!ok) {
    return `[method_exec.refine] refine 失败：form ${form.id} 不存在或不在 open / failed 状态。`;
  }
  await ctx.reportContextEdit?.();
  const updated = manager.get(form.id);
  if (!updated) {
    // refine 触发 quick_exec_submit 且执行成功 → form 已自动移除。
    return `Form ${form.id} 参数补齐后已自动提交并执行成功（form 已关闭）。`;
  }
  if (updated.class === "method_exec" && updated.status === "failed") {
    return `Form ${form.id} 参数累积后自动提交但执行失败：${updated.result ?? "(无错误详情)"}。可继续 refine 修正后重试。`;
  }
  const paths = updated.class === "method_exec" ? updated.intentPaths.join(", ") : "";
  const revived = form.status === "failed" ? "（form 从 failed 复活, 已切回 open, 可 submit）" : "";
  const tip = updated.class === "method_exec" && updated.tip ? ` tip=${JSON.stringify(updated.tip.slice(0, 200))}` : "";
  return `Form ${form.id} 已累积参数${revived}。当前路径：${paths}。${tip}`;
}

/**
 * refine is a meta-method on the form itself; it fires directly without a form
 * (otherwise opening a refine would create a nested form).
 */
export const refineMethod: ObjectMethod = {
  description: "Refine this form by accumulating more args (key/value merge).",
  exec: (ctx) => executeRefine(ctx),
};
