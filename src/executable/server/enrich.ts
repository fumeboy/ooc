import type { ThreadContext } from "../../thinkable/context";
import { enrichFormCommandKnowledge } from "../index.js";
import type { ActiveForm } from "../forms/form";

/**
 * 根据 form.command / args / status 计算 command knowledge，并把关联 path 回写到 form。
 *
 * 为兼容既有调用点，函数名仍保留 enrichProgramForm，但其语义已升级为通用 command knowledge enrich。
 *
 * 返回新对象（immutable），不就地改原 form。
 */
export async function enrichProgramForm(
  form: ActiveForm,
  thread: ThreadContext
): Promise<ActiveForm> {
  return await enrichFormCommandKnowledge(form, thread);
}
