import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { objectDir, type FlowObjectRef } from "./common";

/**
 * Flow client 页面持久化薄壳。
 *
 * - Flow：多页 `<objectDir>/client/pages/{pageName}.tsx`
 *
 * 设计对照 stone-server.ts：mkdir + writeFile + ENOENT 静默返回 undefined。
 * 不做语法校验、不做模板预填——把"约定文件路径"这一件事做干净就好。
 */

/** Flow object 的 client/pages 目录绝对路径。 */
export function flowClientPagesDir(ref: FlowObjectRef): string {
  return join(objectDir(ref), "client", "pages");
}

/** Flow object 的某个 page tsx 绝对路径。 */
export function flowClientPageFile(ref: FlowObjectRef, pageName: string): string {
  if (!isSafePageName(pageName)) {
    throw new Error(`invalid page name '${pageName}'; must match /^[A-Za-z0-9_-]+$/`);
  }
  return join(flowClientPagesDir(ref), `${pageName}.tsx`);
}

/** 读取 flow object 的某个 page tsx；不存在返回 undefined。 */
export async function readFlowClientPage(
  ref: FlowObjectRef,
  pageName: string,
): Promise<string | undefined> {
  return readSourceOrUndefined(flowClientPageFile(ref, pageName));
}

/** 写入 flow object 的某个 page tsx，自动 mkdir client/pages/。 */
export async function writeFlowClientPage(
  ref: FlowObjectRef,
  pageName: string,
  code: string,
): Promise<void> {
  const file = flowClientPageFile(ref, pageName);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, code, "utf8");
}

async function readSourceOrUndefined(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * page 名只允许 [A-Za-z0-9_-]，杜绝路径穿越与 tsx 之外的扩展名拼接歧义。
 * 与 doc 中"一个 tsx = 一个页面"的契约一致。
 */
function isSafePageName(name: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(name);
}
