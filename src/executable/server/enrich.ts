import { deriveStoneFromThread } from "../../persistable";
import type { ActiveForm } from "../forms/form";
import type { ThreadContext } from "../../thinkable/context";
import { loadServerMethods } from "./loader";
import type { ServerMethod } from "./types";

/**
 * 默认 knowledge 生成器：把方法的 description + params 拼成基线文本。
 * 当 ServerMethod 没有显式提供 knowledge 函数时回退到这里，保证 LLM 至少有静态提示。
 */
function defaultKnowledge(method: ServerMethod): string {
  const lines: string[] = [];
  if (method.description) {
    lines.push(method.description);
  }
  if (method.params && method.params.length > 0) {
    lines.push("参数：");
    for (const p of method.params) {
      const required = p.required ? "（必填）" : "（可选）";
      const type = p.type ? ` [${p.type}]` : "";
      const desc = p.description ? `：${p.description}` : "";
      lines.push(`- ${p.name}${type}${required}${desc}`);
    }
  }
  return lines.join("\n");
}

/**
 * 当 form.command === "program" 且 accumulatedArgs.function 是已注册方法名时，
 * 调用方法的 knowledge(currentArgs) 函数（缺省时按 description+params 自动生成），
 * 把返回文本写入 form.methodKnowledge，让 LLM 在下一轮 active_forms 直接看到方法说明。
 *
 * - command 不是 program 或没 function 字段 → 清掉残留 methodKnowledge 后返回
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
    if (form.methodKnowledge === undefined) return form;
    const next = { ...form };
    delete next.methodKnowledge;
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
    if (form.methodKnowledge === undefined) return form;
    const next = { ...form };
    delete next.methodKnowledge;
    return next;
  }

  // 与 command.match(args)→paths 同构：knowledge 也是基于当前 args 动态派生
  const methodArgs = (form.accumulatedArgs.args as Record<string, unknown> | undefined) ?? {};
  let text: string;
  try {
    text = method.knowledge ? method.knowledge(methodArgs) : defaultKnowledge(method);
  } catch {
    // knowledge 函数自身崩了 → 退化到默认实现，避免一个用户写错的 knowledge fn 卡死整个 form
    text = defaultKnowledge(method);
  }

  if (text === "") {
    // 空文本视为无知识 → 清掉
    if (form.methodKnowledge === undefined) return form;
    const next = { ...form };
    delete next.methodKnowledge;
    return next;
  }

  return { ...form, methodKnowledge: text };
}
