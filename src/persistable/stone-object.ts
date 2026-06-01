import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, STONE_CHILDREN_SUBDIR, STONE_OBJECTS_SUBDIR, toJson, type StoneObjectRef } from "./common";
import { STONES_MAIN_BRANCH } from "./stone-bootstrap";
import { selfFile } from "./stone-self";
import { readmeFile, readableFile } from "./stone-readme";

export { stoneDir };

/** 写入 `.stone.json` 的元数据。 */
export interface StoneObjectMetadata {
  /** 元数据判别字段，区分 .stone.json 与 .flow.json / .pool.json。 */
  type: "stone";
  /** 与 ref 同步的 objectId 副本，便于离线读取无需推断目录结构。 */
  objectId: string;
}

/** stone 元数据文件 `.stone.json` 的绝对路径。 */
export function stoneMetadataFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), ".stone.json");
}

/** stone 的 server 目录。 */
/** @deprecated Use executableDir instead (2026-05-28 ooc-6 Object Unification). server/ is being renamed to executable/. */
export function serverDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "server");
}

/**
 * stone 的 executable 目录（原 server/ 重命名，2026-05-28 ooc-6）。
 * 存放 Object 的 methods 实现。
 */
export function executableDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "executable");
}

/** stone 的 client 目录。 */
/** @deprecated Use visibleDir instead (2026-05-28 ooc-6 Object Unification). client/ is being renamed to visible/. */
export function clientDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "client");
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
 * - 这里是先天/设计层 seed：`stones/<branch>/objects/<self>/knowledge/<slug>.md`，由 Object 主动写入并经 git review
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
 * 创建 stone 的最小可见骨架：`.stone.json` + `self.md` + `readable.md`（**空文件占位**）。
 *
 * 创建的初始文件（2026-05-28 修订，ooc-6 Object Unification）:
 * - `.stone.json`：元数据
 * - `self.md`：**空文件**——`ls stoneDir` 可见；readSelf 返回 ""；
 *   `loadSelfInstructions` 视 empty 等价 undefined，故不会注入空 instructions。
 *   正文由 Object 后续主动 writeSelf 写入。
 * - `readable.md`：**空文件**——同上语义；正文由 Object 后续主动 writeReadable 写入。
 *   （原 readme.md 已重命名为 readable.md，2026-05-28）
 *
 * **不预创**的目录（按需 lazy 创建，避免 `ls` 看到一堆空目录引发"骨架不全"误判）:
 * - executable/（原 server/） ← 写第一个 executable method 时自动 mkdir
 * - visible/（原 client/） ← 写第一个 visible 入口时自动 mkdir
 * - knowledge/ ← seed knowledge 完全可选；首次 write_file 时 lazy mkdir
 *
 * **不再创建** files/（2026-05-23 起迁到 pool；详见 createPoolObject）。
 * **不再创建** database/（2026-05-24 起删除；csv 替代 sql；详见 persistable.pool.children.data_pool）。
 */
export async function createStoneObject(ref: StoneObjectRef): Promise<StoneObjectRef> {
  await mkdir(stoneDir(ref), { recursive: true });

  const metadata: StoneObjectMetadata = { type: "stone", objectId: ref.objectId };
  await writeFile(stoneMetadataFile(ref), toJson(metadata), "utf8");

  await writeFile(selfFile(ref), "", "utf8");
  await writeFile(readableFile(ref), "", "utf8");
  // Legacy readme.md created for backward compatibility during migration
  await writeFile(readmeFile(ref), "", "utf8");

  return ref;
}

// 已迁出的函数（2026-05-23 三分重组）：
// - knowledgeDir / memoryDir / relationsDir / relationFile / readRelation
//   → src/persistable/pool-object.ts 的 poolKnowledgeDir / poolKnowledgeMemoryDir /
//     poolKnowledgeRelationsDir / poolKnowledgeRelationFile / readPoolRelation
// - filesDir
//   → src/persistable/pool-object.ts 的 poolFilesDir
// - dataFile / readData / writeData / mergeData (旧 stone-data.ts，已删除)
//   → 语义改为 session-scoped；详见 src/persistable/flow-data.ts
//
// 保留 readFile import 以备未来 stone 内其它"内容文件"读取需要；目前未直接使用。
// intentional: silent-swallow ban 例外——这是 unused-import keep-alive，不是错误吞噬。
void readFile;

/**
 * 发现 ref 在 stone 树上的"层级邻居"：
 * - siblings: 与 ref 同父的其它 OOC Agent objectId（top-level 时 = 其它顶层 Agent）
 * - children: ref 自身 children/ 下一级的 OOC Agent objectId（不递归）
 *
 * "OOC Agent" 判定：目录内含 `self.md`（Agent identity marker）。`user` 是 passive
 * flow object，不算 Agent，永远过滤掉（无论它出现在 sibling 还是 child 列表）。
 *
 * 用于 thinkable.deriveRelationWindow 每轮派生默认 relation_window，让 Agent 默认
 * 看见同级 + 一级 children 的关系窗口（spec 2026-05-27 collaborable.relation_window
 * default visibility）。任何路径异常（ENOENT / EACCES）静默回空，不抛——deriveRelationWindow
 * 是热路径，不能被一次磁盘抖动拖垮。
 */
export async function discoverStoneHierarchicalPeers(
  ref: StoneObjectRef,
): Promise<{ siblings: string[]; children: string[] }> {
  const segments = ref.objectId.split("/").filter(Boolean);
  const branch = ref.stonesBranch ?? STONES_MAIN_BRANCH;
  const objectsRoot = join(ref.baseDir, "stones", branch, STONE_OBJECTS_SUBDIR);

  // 兄弟扫描：top-level 时直接 objectsRoot；嵌套时父对象的 children/
  let siblingsDir: string;
  let parentObjectId: string | undefined;
  if (segments.length <= 1) {
    siblingsDir = objectsRoot;
    parentObjectId = undefined;
  } else {
    parentObjectId = segments.slice(0, -1).join("/");
    siblingsDir = stoneChildrenDir({ baseDir: ref.baseDir, objectId: parentObjectId, stonesBranch: branch });
  }
  const lastSegment = segments[segments.length - 1] ?? "";
  const siblings = await listAgentDirsAt(siblingsDir, parentObjectId, lastSegment);

  // 子 Agent 扫描：自身 children/
  const childrenDir = stoneChildrenDir(ref);
  const children = await listAgentDirsAt(childrenDir, ref.objectId, undefined);

  return { siblings, children };
}

/**
 * 枚举一个目录下的 Agent 子目录（含 self.md），返回它们的 objectId。
 * - prefix === undefined → 视为 top-level 扫描，objectId = entry.name
 * - prefix !== undefined → objectId = `${prefix}/${entry.name}`
 * - excludeName: 同名跳过（用于排除 self）
 * - "user" / STONE_CHILDREN_SUBDIR 永远跳过；前者非 Agent，后者是 marker 子目录
 */
async function listAgentDirsAt(
  dir: string,
  prefix: string | undefined,
  excludeName: string | undefined,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "user") continue;
    if (e.name === STONE_CHILDREN_SUBDIR) continue;
    if (excludeName !== undefined && e.name === excludeName) continue;
    try {
      const s = await stat(join(dir, e.name, "self.md"));
      if (!s.isFile()) continue;
    } catch {
      continue;
    }
    out.push(prefix ? `${prefix}/${e.name}` : e.name);
  }
  return out.sort();
}
