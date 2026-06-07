import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, STONE_CHILDREN_SUBDIR, toJson, type StoneObjectRef } from "./common";
import { selfFile } from "./stone-self";
import { readableFile } from "./stone-readme";

export { stoneDir };

/**
 * stone 的 executable 目录（原 server/ 重命名，2026-05-28 ooc-6）。
 * 存放 Object 的 methods 实现。
 */
export function executableDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "executable");
}

/**
 * stone 的 visible 目录（原 client/ 重命名，2026-05-28 ooc-6）。
 * 存放 Object 的 UI 组件实现。
 */
export function visibleDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "visible");
}

/**
 * stone 的 knowledge 目录（seed knowledge；进 git review）。
 *
 * 与 pool 的 sediment knowledge 二分（参考 meta/object.doc.ts `persistable.stone.children.seed_knowledge`）：
 * - 这里是先天/设计层 seed：`packages/<self>/knowledge/<slug>.md`，由 Object 主动写入并经 git review
 * - pool 侧 sediment：`pools/objects/<self>/knowledge/memory|relations/...`，运行时积累，不进 git
 *
 * loader 双源扫描时统一加载、LLM 视角不分来源；同名冲突 sediment 胜出（详见 loader.ts loadKnowledgeIndex）。
 */
export function stoneKnowledgeDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "knowledge");
}

/**
 * stone 的 children 目录（B-tree 协议，2026-05-26）。子 Agent 物理嵌套在
 * `<parent>/children/<child>/`。详见 meta/object.doc.ts:thinkable.children.knowledge.patches.domain_axis。
 */
export function stoneChildrenDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), STONE_CHILDREN_SUBDIR);
}

/**
 * 把嵌套 objectId 解析为从根到 immediate parent 的祖先 objectId 列表。
 *
 * 例：
 * - "parent"              → []          // 顶层 Agent 没有祖先
 * - "parent/child"        → ["parent"]
 * - "a/b/c"               → ["a", "a/b"]
 *
 * 用于 knowledge loader 在加载子 Agent 时遍历祖先目录，按 frontmatter `inheritable`
 * 决定是否下传知识（详见 src/thinkable/knowledge/loader.ts）。
 */
export function ancestorObjectIds(objectId: string): string[] {
  const segments = objectId.split("/").filter(Boolean);
  const result: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    result.push(segments.slice(0, i).join("/"));
  }
  return result;
}

/**
 * 发现给定 Object 的同级（siblings）和直接子级（children）peer Object。
 *
 * 规则：
 * - siblings: 与 self 同目录下的其它 object package（排除 self、@ 开头、. 开头、children/ marker）
 * - children: self 目录下 children/ 子目录中的 object package
 * - 判定 object package：目录下存在 package.json 或 self.md
 *
 * 调用方：synthesizer.ts 的 relation_window 派生 + peer_object_window 派生。
 */
export async function discoverStoneHierarchicalPeers(ref: StoneObjectRef): Promise<{
  siblings: string[];
  children: string[];
}> {
  const selfDir = stoneDir(ref);
  const selfId = ref.objectId.split("/").pop() ?? ref.objectId;

  // Collect siblings
  const parentDir = join(selfDir, "..");
  const parentStat = await stat(parentDir).catch(() => null);
  const siblings: string[] = [];

  if (parentStat?.isDirectory()) {
    const entries = await readdir(parentDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === selfId) continue;
      if (e.name === STONE_CHILDREN_SUBDIR) continue;
      if (e.name.startsWith(".")) continue;
      if (e.name.startsWith("@")) continue; // skip @ooc/ etc.
      const candidate = join(parentDir, e.name);
      const hasPackage = await stat(join(candidate, "package.json")).catch(() => null);
      const hasSelf = await stat(join(candidate, "self.md")).catch(() => null);
      if (hasPackage || hasSelf) {
        const parentObjectId = ref.objectId.includes("/")
          ? ref.objectId.slice(0, ref.objectId.lastIndexOf("/"))
          : "";
        siblings.push(parentObjectId ? `${parentObjectId}/${e.name}` : e.name);
      }
    }
  }

  // Collect direct children
  const childrenDir = join(selfDir, STONE_CHILDREN_SUBDIR);
  const childrenStat = await stat(childrenDir).catch(() => null);
  const children: string[] = [];

  if (childrenStat?.isDirectory()) {
    const entries = await readdir(childrenDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".")) continue;
      if (e.name.startsWith("@")) continue;
      const candidate = join(childrenDir, e.name);
      const hasPackage = await stat(join(candidate, "package.json")).catch(() => null);
      const hasSelf = await stat(join(candidate, "self.md")).catch(() => null);
      if (hasPackage || hasSelf) {
        children.push(`${ref.objectId}/${e.name}`);
      }
    }
  }

  return { siblings, children };
}

/**
 * 创建 stone 的最小可见骨架：`package.json` + `self.md` + `readable.md`（**空文件占位**）。
 *
 * 创建的初始文件（2026-06-01 bun workspace 修订）:
 * - `package.json`：bun workspace package metadata (ooc.objectId, ooc.kind="object")
 * - `self.md`：**空文件**——`ls stoneDir` 可见；readSelf 返回 ""；
 *   `loadSelfInstructions` 视 empty 等价 undefined，故不会注入空 instructions。
 *   正文由 Object 后续主动 writeSelf 写入。
 * - `readable.md`：**空文件**——同上语义；正文由 Object 后续主动 writeReadable 写入。
 *
 * **不预创**的目录（按需 lazy 创建，避免 `ls` 看到一堆空目录引发"骨架不全"误判）:
 * - executable/（原 server/） ← 写第一个 executable method 时自动 mkdir
 * - visible/（原 client/） ← 写第一个 visible 入口时自动 mkdir
 * - knowledge/ ← seed knowledge 完全可选；首次 write_file 时 lazy mkdir
 *
 * **不再创建** files/（2026-05-23 起迁到 pool；详见 createPoolObject）。
 * **不再创建** database/（2026-05-24 起删除；csv 替代 sql；详见 persistable.pool.children.data_pool）。
 */
export async function createStoneObject(
  ref: StoneObjectRef,
  opts?: { class?: string },
): Promise<StoneObjectRef> {
  const dir = stoneDir(ref);
  await mkdir(dir, { recursive: true });

  // Write package.json for bun workspace.
  // opts.class（可选）写入 ooc.class —— object 的权威继承声明（class 实例化时设父类）。
  const pkgJson = {
    name: `@ooc-obj/${ref.objectId.replace(/\//g, "-").replace(/_/g, "-")}`,
    version: "0.1.0",
    private: true,
    type: "module",
    ooc: {
      objectId: ref.objectId,
      kind: "object",
      type: "agent",
      ...(opts?.class ? { class: opts.class } : {}),
    },
  };
  await writeFile(join(dir, "package.json"), toJson(pkgJson), "utf8");

  await writeFile(selfFile(ref), "", "utf8");
  await writeFile(readableFile(ref), "", "utf8");

  return ref;
}

// 已迁出的函数（2026-05-23 三分重组）：
// - knowledgeDir / memoryDir / relationsDir / relationFile / readRelation
//   → src/persistable/pool-object.ts 的 poolKnowledgeDir / poolKnowledgeMemoryDir /
//     poolKnowledgeRelationsDir / poolKnowledgeRelationFile / readPoolRelation
// - filesDir
//   → src/persistable/pool-object.ts 的 poolFilesDir
