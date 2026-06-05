/**
 * server/enrich — 给 method_exec form 补充 command knowledge path 列表。
 *
 * 这个文件曾经叫 enrichProgramForm，名字保留是因为最早只服务 program 模式；
 * 现在它是通用的 method_exec 知识 enrich 入口，所有 command 都会走过来。
 */

import type { ThreadContext } from "../../thinkable/context.js";
import type { MethodExecWindow } from "../windows/_shared/types.js";
import { enrichFormMethodKnowledge } from "../../thinkable/knowledge/index.js";

/**
 * 计算 form 当前的 commandKnowledge keys 并就地写回 form（如果有变）。
 *
 * 返回经过 enrich 的 form 实例（或原对象，当 keys 未变化时）。
 */
export async function enrichProgramFormMethod(
  form: MethodExecWindow,
  thread: ThreadContext,
): Promise<MethodExecWindow> {
  return await enrichFormMethodKnowledge(form, thread);
}

