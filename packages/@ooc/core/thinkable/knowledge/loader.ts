import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  ancestorObjectIds,
  poolKnowledgeDir,
  stoneKnowledgeDir,
  type PoolObjectRef,
  type StoneObjectRef,
} from "../../persistable";
import type { ObjectRegistry } from "../../executable/windows/_shared/registry.js";
import { builtinRegistry } from "../../executable/windows/index.js";
import { parseKnowledgeFile } from "./parser";
import type { KnowledgeDoc, KnowledgeIndex } from "./types";

/** 双源 loader 输入：stone (seed) + pool (sediment) 两个 ref。 */
export interface KnowledgeLoadRefs {
  /** stone 侧 ref（seed knowledge：`stones/<branch>/objects/<id>/knowledge/`，进 git）。 */
  stone: StoneObjectRef;
  /** pool 侧 ref（sediment knowledge：`pools/objects/<id>/knowledge/`，不进 git）。 */
  pool: PoolObjectRef;
}

/** 内部 cache：两侧目录组合签名 → { 上次索引 + 文件签名 }。 */
const cache = new Map<string, { index: KnowledgeIndex; signature: string }>();

/**
 * 双源加载 Object 的 knowledge 索引（stone seed + pool sediment 合并）。
 *
 * 四侧扫描 + 继承：
 * - **目录祖先 seed**：`stones/<branch>/objects/<ancestor>/knowledge/` 下 frontmatter `inheritable: true`
 *   的文件，从 root 向 immediate parent 顺序加载；后加载者覆盖前者（更近的祖先 override 更远的）
 * - **父类链 seed**：parentClass 继承链上各 class 的 `stones/<branch>/objects/<parentClass>/knowledge/`
 *   下 frontmatter `inheritable: true` 的文件，closest → farthest 顺序加载；更近的父类 override 更远的
 * - **self seed**：`stones/<branch>/objects/<id>/knowledge/`（设计层；进 git review）
 * - **self sediment**：`pools/objects/<id>/knowledge/`（运行时认知；不进 git）
 *
 * 加载顺序（前面被后面覆盖）：目录祖先 seed → 父类链 seed → self seed → self sediment。
 * 这样保证：
 * - 父类的 knowledge 覆盖目录祖先（类设计比目录位置更权威）
 * - 子 Agent 自己的 knowledge 永远 override 父级（CSS-cascade 语义）
 * - 运行时 sediment 仍 override 设计层 seed（保留原有行为）
 *
 * 合并规则：
 * - 相对路径（去 .md 后缀）相同视为冲突；后 set 胜出
 * - sediment 与 seed 冲突 console.warn（保留原有诊断）
 * - 祖先继承覆盖 / 子级覆盖父级祖先 → 不 warn，是设计正常路径
 *
 * 容错：
 * - 任一侧目录 ENOENT/不可读 → 静默继续扫其它路径，不报错
 *
 * 祖先 sediment（祖先的 pool）**不下传**：sediment 默认私有于该 Agent，
 * 不通过本协议跨边界共享。
 *
 * Cache：以两侧目录路径联合签名为键；签名未变即返回上次索引（同对象引用）。
 */
export async function loadKnowledgeIndex(
  refs: KnowledgeLoadRefs,
  registry: ObjectRegistry = builtinRegistry,
): Promise<KnowledgeIndex> {
  const stoneRoot = stoneKnowledgeDir(refs.stone);
  const poolRoot = poolKnowledgeDir(refs.pool);

  // 目录祖先 seed 目录列表（从 root → immediate parent）。
  const ancestorIds = ancestorObjectIds(refs.stone.objectId);
  const ancestorRoots = ancestorIds.map((id) =>
    stoneKnowledgeDir({ ...refs.stone, objectId: id }),
  );

  // parentClass 继承链 seed 目录列表（closest → farthest）。
  // 自定义 stone 对象可能尚未注册 → resolveParentClassChain 返回 []，安全降级。
  const parentClassChain = registry.resolveParentClassChain(refs.stone.objectId as any);
  const parentClassRoots = parentClassChain.map((id) =>
    stoneKnowledgeDir({ ...refs.stone, objectId: id }),
  );

  // 收集所有 md 文件（目录祖先 + 父类链 + self stone + self pool）。
  const ancestorFilesByRoot: Array<{ root: string; files: Awaited<ReturnType<typeof collectMdFiles>> }> = [];
  for (const root of ancestorRoots) {
    ancestorFilesByRoot.push({ root, files: await collectMdFiles(root) });
  }
  const parentClassFilesByRoot: Array<{ root: string; files: Awaited<ReturnType<typeof collectMdFiles>> }> = [];
  for (const root of parentClassRoots) {
    parentClassFilesByRoot.push({ root, files: await collectMdFiles(root) });
  }
  const stoneFiles = await collectMdFiles(stoneRoot);
  const poolFiles = await collectMdFiles(poolRoot);

  const signature = [
    ...ancestorFilesByRoot.flatMap(({ root, files }) => [
      `anc:${root}`,
      ...files.map((f) => `a:${f.path}@${f.mtime}`).sort(),
    ]),
    ...parentClassFilesByRoot.flatMap(({ root, files }) => [
      `pc:${root}`,
      ...files.map((f) => `p:${f.path}@${f.mtime}`).sort(),
    ]),
    `stone:${stoneRoot}`,
    ...stoneFiles.map((f) => `s:${f.path}@${f.mtime}`).sort(),
    `pool:${poolRoot}`,
    ...poolFiles.map((f) => `p:${f.path}@${f.mtime}`).sort(),
  ].join("|");

  const cacheKey = [...ancestorRoots, ...parentClassRoots, stoneRoot, poolRoot].join("::");
  const cached = cache.get(cacheKey);
  if (cached && cached.signature === signature) {
    return cached.index;
  }

  const byPath = new Map<string, KnowledgeDoc>();

  // Step 1: 目录祖先 seed —— 仅 frontmatter.inheritable === true 的文件。
  // 顺序：root → immediate parent，更近的祖先后 set 自然 override 更远的。
  for (const { root, files } of ancestorFilesByRoot) {
    for (const f of files) {
      const parsed = await readAndParse(f.path);
      if (!parsed) continue;
      if (parsed.frontmatter.inheritable !== true) continue;
      const idPath = toIdPath(root, f.path);
      byPath.set(idPath, {
        path: idPath,
        file: f.path,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        mtime: f.mtime,
      });
    }
  }

  // Step 1b: parentClass 继承链 seed —— **无条件继承**（不门控 inheritable）。
  // class 存在的意义就是被 object 继承，其 seed knowledge 应整体流向 instance；这与
  // Step 1 的目录域祖先继承（child Agent opt-in，需 inheritable:true）是不同的轴。
  // 顺序：closest parent → farthest parent，更近的父类后 set override 更远的。
  for (const { root, files } of parentClassFilesByRoot) {
    for (const f of files) {
      const parsed = await readAndParse(f.path);
      if (!parsed) continue;
      const idPath = toIdPath(root, f.path);
      byPath.set(idPath, {
        path: idPath,
        file: f.path,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        mtime: f.mtime,
      });
    }
  }

  // Step 2: self seed —— 自然 override 同 idPath 的祖先 knowledge（目录祖先 + parentClass）。
  for (const f of stoneFiles) {
    const parsed = await readAndParse(f.path);
    if (!parsed) continue;
    const idPath = toIdPath(stoneRoot, f.path);
    byPath.set(idPath, {
      path: idPath,
      file: f.path,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      mtime: f.mtime,
    });
  }

  // Step 3: self sediment —— 同 idPath 时覆盖 seed（含祖先 seed）并 warn。
  for (const f of poolFiles) {
    const parsed = await readAndParse(f.path);
    if (!parsed) continue;
    const idPath = toIdPath(poolRoot, f.path);
    if (byPath.has(idPath)) {
      const prev = byPath.get(idPath)!;
      console.warn(
        `[knowledge-loader] conflict path="${idPath}" seed=${prev.file} sediment=${f.path} resolution=sediment_wins`,
      );
    }
    byPath.set(idPath, {
      path: idPath,
      file: f.path,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      mtime: f.mtime,
    });
  }

  const index: KnowledgeIndex = { byPath };
  cache.set(cacheKey, { index, signature });
  return index;
}

/** 测试钩子：清空 loader 缓存。 */
export function clearKnowledgeLoaderCache(): void {
  cache.clear();
}

/**
 * 从单个目录加载 knowledge 索引（无祖先 / 父类链 / pool 合并）。
 *
 * 给框架内置知识用：root 等 builtin object 的 knowledge 随框架包发布、运行进程内不可变，
 * 由 caller 自行 memoize。idPath 为相对该目录的路径（去 .md）。
 */
export async function loadKnowledgeIndexFromDir(dir: string): Promise<KnowledgeIndex> {
  const byPath = new Map<string, KnowledgeDoc>();
  for (const f of await collectMdFiles(dir)) {
    const parsed = await readAndParse(f.path);
    if (!parsed) continue;
    const idPath = toIdPath(dir, f.path);
    byPath.set(idPath, {
      path: idPath,
      file: f.path,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      mtime: f.mtime,
    });
  }
  return { byPath };
}

/**
 * 读 + 解析单篇 knowledge md。
 *
 * 解析失败（含旧 schema / 非法 trigger）→ console.warn 含文件路径，返回 undefined
 * （让 loader 跳过这篇；不让一个写错 frontmatter 的 sediment 让整个 index 加载失败）。
 *
 * silent-swallow ban 立场：parser 已经 fail-loud；loader 把异常转换为带路径的
 * warning 后跳过，"知情跳过" 而不是静默吞错。
 */
async function readAndParse(
  filePath: string,
): Promise<{ frontmatter: import("./types").KnowledgeFrontmatter; body: string } | undefined> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (err) {
    console.warn(`[knowledge-loader] read failed ${filePath}: ${(err as Error).message}`);
    return undefined;
  }
  try {
    return parseKnowledgeFile(text);
  } catch (err) {
    console.warn(
      `[knowledge-loader] parse failed ${filePath}: ${(err as Error).message}`,
    );
    return undefined;
  }
}

/** 相对路径（去 .md 后缀，统一斜杠）作为 KnowledgeDoc.path 的 idPath。 */
function toIdPath(root: string, abs: string): string {
  const rel = relative(root, abs).replace(/\.md$/, "");
  return rel.split(/[\\/]/).join("/");
}

async function collectMdFiles(root: string): Promise<Array<{ path: string; mtime: number }>> {
  const result: Array<{ path: string; mtime: number }> = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        const s = await stat(p);
        result.push({ path: p, mtime: s.mtimeMs });
      }
    }
  }
  await walk(root);
  return result;
}
