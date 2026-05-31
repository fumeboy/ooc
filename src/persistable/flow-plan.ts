/**
 * Flow-layer plan.md IO —— 承载 B 类 plan 塌缩后的 owner-scoped 行动计划（OOC-4 L5b）。
 *
 * 路径形态：`{baseDir}/flows/{sessionId}/objects/{objectId}/plan.md`
 * （与 todos.json / data.json 同级）。单一 active plan 的 markdown 文本。
 *
 * 语义（spec L5-6 §4 plan + §D1）：
 * - plan 属**对象**（object-scoped），不属单个 thread——该对象在本 session 下的所有 thread
 *   （root + child do threads，因 deriveChildPersistence 共享 objectId）自视都渲染同一份 plan。
 *   这取代了旧 plan_window 的 share_windows 跨 thread 共享机制（object-scoped 自动满足）。
 * - MVP 扁平：plan.md 是单一 markdown 文本，LLM 把 steps 作 markdown checklist
 *   （`- [ ]` / `- [x]`）在 content 里自管；不再有结构化 PlanWindowStep / sub-plan 嵌套。
 * - 写经 enqueueSessionWrite 串行化（仿 flow-todos.ts），同对象 write 不丢更新。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { objectDir, type FlowObjectRef } from "./common";
import { enqueueSessionWrite } from "./serial-queue";

/** flow object 的行动计划文件 `plan.md` 的绝对路径。 */
export function planFile(ref: FlowObjectRef): string {
  return join(objectDir(ref), "plan.md");
}

/** 同对象级串行写队列 key（仿 flow-todos；同 object 的 plan 写严格串行）。 */
function queueKey(ref: FlowObjectRef): string {
  return `flow-plan:${ref.baseDir}:${ref.sessionId}:${ref.objectId}`;
}

/**
 * 读取 flow object 的 plan.md：
 * - 文件不存在（ENOENT）返回空字符串 ""。
 * - 其它读错误向上抛（不静默吞掉）。
 */
export async function readPlan(ref: FlowObjectRef): Promise<string> {
  const file = planFile(ref);
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/**
 * 整体覆盖写 plan.md：
 * - 自动 mkdir -p 父目录。
 * - 通过 enqueueSessionWrite 串行化（同对象级队列）。
 */
export async function writePlan(ref: FlowObjectRef, md: string): Promise<void> {
  const file = planFile(ref);
  await enqueueSessionWrite(queueKey(ref), async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, md, "utf8");
  });
}
