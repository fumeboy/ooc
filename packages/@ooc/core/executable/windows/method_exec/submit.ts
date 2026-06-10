/**
 * method_exec.submit —— 触发 form.method.exec。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "../_shared/method-types.js";
import type { MethodExecWindow } from "../_shared/types.js";
import type { WindowManager } from "../_shared/manager.js";

async function executeSubmit(ctx: MethodExecutionContext): Promise<string | undefined> {
  const form = ctx.self as MethodExecWindow;
  if (form.status !== "open") {
    return `[method_exec.submit] form ${form.id} 不在 open 状态（当前 ${form.status}）。`;
  }
  if (!ctx.manager || !ctx.thread) {
    return "[method_exec.submit] 缺少 manager / thread 上下文。";
  }
  const manager = ctx.manager as WindowManager;
  try {
    const result = await manager.submit(form.id, ctx.thread);
    const after = manager.get(form.id);
    const removed = !after;
    const title = form.method;
    const messageBase = removed
      ? `[form success] form "${title}" 已成功执行并自动释放。`
      : `[form failed] form "${title}" 执行失败（status=failed; refine 修正参数后可重 submit, 或 close 放弃）。`;
    return result !== undefined ? `${messageBase}\n${result}` : messageBase;
  } catch (err) {
    return `[method_exec.submit] submit 失败：${(err as Error).message}`;
  }
}

/**
 * submit is a meta-method on the form itself; fires directly without a nested form.
 */
export const submitMethod: ObjectMethod = {
  description: "Submit this form to execute the method.",
  exec: (ctx) => executeSubmit(ctx),
};
