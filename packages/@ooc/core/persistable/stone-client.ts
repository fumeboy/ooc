import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { objectDir, type FlowObjectRef, type StoneObjectRef } from "./common";
import { clientDir, visibleDir } from "./stone-object";

/**
 * client 持久化薄壳。
 *
 * - Stone：单页入口 `<packageDir>/client/index.tsx`
 * - Flow：多页 `<objectDir>/client/pages/{pageName}.tsx`
 *
 * 设计对照 stone-server.ts：mkdir + writeFile + ENOENT 静默返回 undefined。
 * 不做语法校验、不做模板预填——把"约定文件路径"这一件事做干净就好。
 */

/** Stone 的 client 入口 tsx 绝对路径。 */
/** @deprecated Use visibleIndexFile instead (2026-05-28 ooc-6 Object Unification). client/ is being renamed to visible/. */
export function clientIndexFile(ref: StoneObjectRef): string {
  return join(clientDir(ref), "index.tsx");
}

/**
 * Stone 的 visible/index.tsx 绝对路径（原 client/index.tsx 重命名，2026-05-28 ooc-6）。
 * 存放 Object 的 UI 组件实现。
 */
export function visibleIndexFile(ref: StoneObjectRef): string {
  return join(visibleDir(ref), "index.tsx");
}

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

/** 读取 stone 的 client/index.tsx；不存在返回 undefined。 */
/** @deprecated Use readVisibleSource instead (2026-05-28 ooc-6 Object Unification). */
export async function readStoneClientSource(ref: StoneObjectRef): Promise<string | undefined> {
  return readSourceOrUndefined(clientIndexFile(ref));
}

/**
 * 读取 stone 的 visible/index.tsx；不存在返回 undefined。
 * 迁移期双读：优先 visible/，fallback 到 client/。
 */
export async function readVisibleSource(ref: StoneObjectRef): Promise<string | undefined> {
  const result = await readSourceOrUndefined(visibleIndexFile(ref));
  if (result !== undefined) return result;
  // Migration fallback: try old client/ path
  return readSourceOrUndefined(clientIndexFile(ref));
}

/** 写入 stone 的 client/index.tsx，自动 mkdir client/。 */
/** @deprecated Use writeVisibleSource instead (2026-05-28 ooc-6 Object Unification). */
export async function writeStoneClientSource(ref: StoneObjectRef, code: string): Promise<void> {
  const file = clientIndexFile(ref);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, code, "utf8");
}

/**
 * 写入 stone 的 visible/index.tsx，自动 mkdir visible/。
 * 迁移期双写：同时写 visible/ 和 client/。
 */
export async function writeVisibleSource(ref: StoneObjectRef, code: string): Promise<void> {
  const file = visibleIndexFile(ref);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, code, "utf8");
  // Migration dual-write: also write to old client/ path
  const oldFile = clientIndexFile(ref);
  await mkdir(dirname(oldFile), { recursive: true });
  await writeFile(oldFile, code, "utf8");
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
