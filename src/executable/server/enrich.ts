import { deriveStoneFromThread } from "../../persistable";
import type { ActiveForm } from "../forms/form";
import type { ThreadContext } from "../../thinkable/context";
import { loadServerMethods } from "./loader";

/**
 * 当 form.command === "program" 且 accumulatedArgs.function 是已注册方法名时，
 * 把方法的 description + params 快照写入 form.methodSchema，让 LLM 在下一轮 active_forms 直接看到方法签名。
 *
 * - command 不是 program 或没 function 字段 → 清掉残留 schema 后返回
 * - 找不到方法 / 加载失败 → 静默返回（不污染 context；submit 时调用方仍会拿到清晰的错误）
 *
 * 返回新对象（immutable），不就地改原 form。
 */
export async function enrichProgramForm(
  form: ActiveForm,
  thread: ThreadContext
): Promise<ActiveForm> {
  if (form.command !== "program") {
    return form;
  }

  const fn = form.accumulatedArgs.function;
  if (typeof fn !== "string" || fn.length === 0) {
    if (form.methodSchema === undefined) return form;
    const next = { ...form };
    delete next.methodSchema;
    return next;
  }

  if (!thread.persistence) {
    return form;
  }

  const stoneRef = deriveStoneFromThread(thread.persistence);
  let methods;
  try {
    methods = await loadServerMethods(stoneRef);
  } catch {
    return form;
  }

  const method = methods[fn];
  if (!method) {
    if (form.methodSchema === undefined) return form;
    const next = { ...form };
    delete next.methodSchema;
    return next;
  }

  return {
    ...form,
    methodSchema: {
      description: method.description,
      params: method.params,
    },
  };
}
