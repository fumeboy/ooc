/**
 * Flow-layer todos.json IO —— 承载 B 类 todo 塌缩后的 owner-scoped 待办（OOC-4 L5a）。
 *
 * 路径形态：`{baseDir}/flows/{sessionId}/objects/{objectId}/data.json` 的同级 `todos.json`。
 *
 * 语义（spec L5-6 §4 todo + plan §D1）：
 * - todos 属**对象**（object-scoped），不属单个 thread——该对象在本 session 下的所有 thread
 *   （root + child do threads，因 deriveChildPersistence 共享 objectId）自视都渲染同一份 todos。
 *   这是期望语义（todos = 对象级 intent），非 per-thread。
 * - 写经 enqueueSessionWrite 串行化（仿 flow-data.ts），同对象 read-modify-write 不丢更新。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { objectDir, toJson, type FlowObjectRef } from "./common";
import { enqueueSessionWrite } from "./serial-queue";

/**
 * 单条待办。
 *
 * - id：稳定标识，用于 check / uncheck / remove。
 * - content：待办正文。
 * - done：是否已完成（自视切片只渲未完成）。
 * - onCommandPath：可选；命中这些 command path 时强提醒（MVP 仅作常驻标注）。
 */
export interface Todo {
  id: string;
  content: string;
  done: boolean;
  onCommandPath?: string[];
}

/** flow object 的待办文件 `todos.json` 的绝对路径。 */
export function todosFile(ref: FlowObjectRef): string {
  return join(objectDir(ref), "todos.json");
}

/** 同对象级串行写队列 key（仿 flow-data；同 object 的 read-modify-write 严格串行）。 */
function queueKey(ref: FlowObjectRef): string {
  return `flow-todos:${ref.baseDir}:${ref.sessionId}:${ref.objectId}`;
}

/**
 * 读取 flow object 的 todos.json：
 * - 文件不存在（ENOENT）返回空数组 `[]`。
 * - 内容非数组 / JSON 解析失败抛带 path 的清晰错误。
 */
export async function readTodos(ref: FlowObjectRef): Promise<Todo[]> {
  const file = todosFile(ref);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`flow todos.json 必须是顶层 JSON 数组，实际类型 ${typeof parsed}`);
    }
    return parsed as Todo[];
  } catch (error) {
    throw new Error(
      `解析 flow todos.json 失败 (${file}): ${(error as Error).message}`,
      { cause: error },
    );
  }
}

/**
 * 整体覆盖写 todos.json：
 * - 自动 mkdir -p 父目录。
 * - 通过 enqueueSessionWrite 串行化（同对象级队列）。
 */
export async function writeTodos(ref: FlowObjectRef, todos: Todo[]): Promise<void> {
  const file = todosFile(ref);
  await enqueueSessionWrite(queueKey(ref), async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, toJson(todos), "utf8");
  });
}

/**
 * read-modify-write 串行化：读现有 todos → 应用 mutator → 写回。
 *
 * 整个过程在同对象级队列内串行（仿 mergeFlowData），避免并发 lost-update。
 * 返回 mutator 应用后的最终 todos（便于 caller 取回新增条目 / 当前列表）。
 */
export async function mutateTodos(
  ref: FlowObjectRef,
  mutator: (todos: Todo[]) => Todo[],
): Promise<Todo[]> {
  const file = todosFile(ref);
  return enqueueSessionWrite(queueKey(ref), async () => {
    let existing: Todo[] = [];
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) existing = parsed as Todo[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const next = mutator(existing);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, toJson(next), "utf8");
    return next;
  });
}
