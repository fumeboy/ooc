/**
 * StoneRegistry — 统一的 stone 发现与元数据解析。
 *
 * M2 (2026-06-03): 扫 World 内的用户 stones 与 builtins，解析 package.json#ooc 元数据，
 * 对外提供统一的查询、列举、失效、变更事件订阅。
 *
 * 扫描根:
 * 1. `{worldPath}/stones/` — 用户自己的 stones（扁平 `stones/<objectId>`，嵌套通过 `children/` 子目录）
 * 2. `{worldPath}/node_modules/@ooc/builtins/` — 来自 npm 的 builtins
 * 3. Dual-path fallback: `{worldPath}/packages/`（deprecated，保留一个 release
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_OBJECT_IDS, STONE_CHILDREN_SUBDIR } from "../persistable/common.js";

export type StoneKind = "stone" | "builtin";

export interface StoneDefinition {
  objectId: string;
  kind: StoneKind;
  dir: string;
  packageJson: Record<string, unknown>;
  oocMetadata?: {
    objectId?: string;
    kind?: StoneKind;
    type?: string;
    prototype?: string;
  };
  mtime: number;
}

export type StoneChangedEvent =
  | { kind: "code"; objectId: string; files: string[] }
  | { kind: "view"; objectId: string; files: string[] }
  | { kind: "knowledge"; objectId: string; files: string[] }
  | { kind: "identity"; objectId: string; field?: string };

type Listener = (ev: StoneChangedEvent) => void;

export interface StoneRegistry {
  readonly worldPath: string;
  getDef(objectId: string): StoneDefinition | undefined;
  list(): StoneDefinition[];
  listByKind(kind: StoneKind): StoneDefinition[];
  rescan(): Promise<void>;
  on(event: "stone:changed", listener: Listener): () => void;
  invalidate(objectId: string, files: string[]): Promise<void>;
}

function classifyChange(files: string[]): StoneChangedEvent["kind"] {
  for (const f of files) {
    if (f.includes(`/${STONE_CHILDREN_SUBDIR}/`)) continue;
    if (f.includes("/visible/")) return "view";
    if (f.includes("/knowledge/") || f.endsWith("/readable.md")) return "knowledge";
    if (f.endsWith("/self.md") || f.endsWith("/package.json")) return "identity";
  }
  return "code";
}

async function tryReadPackageJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return undefined;
  }
}

/**
 * 递归扫描一个目录，找出所有带 package.json 的子目录作为 stone。
 *
 * @param rootDir 扫描根目录（stones/ 或 node_modules/@ooc/builtins/ 或 packages/）
 * @param kind 该目录树下 stone 的默认 kind
 * @param stones 结果 Map（key 写入）
 */
async function scanTree(
  rootDir: string,
  kind: StoneKind,
  stones: Map<string, StoneDefinition>,
): Promise<void> {
  async function walk(currentDir: string, idSegments: string[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }

    // 当前目录是否是一个 stone（有 package.json 且非根）
    const pkgJsonEntry = entries.find((e) => e.isFile() && e.name === "package.json");
    if (pkgJsonEntry && idSegments.length > 0) {
      const objectId = idSegments.join("/");
      const pkgJsonPath = join(currentDir, "package.json");
      const pkg = await tryReadPackageJson(pkgJsonPath);
      if (pkg) {
        let statInfo;
        try {
          statInfo = await stat(currentDir);
        } catch {
          statInfo = { mtimeMs: 0 };
        }
        const ooc = (pkg as any).ooc as StoneDefinition["oocMetadata"];
        const finalId = ooc?.objectId ?? objectId;
        let finalKind: StoneKind;
        if (kind === "builtin") {
          finalKind = "builtin";
        } else {
          // User stones may write ooc.kind as "object" or "stone"; normalize to "stone".
          finalKind = "stone";
        }
        if (finalId) {
          // 用户 world 的 stones/ 目录下的所有 object 都纳入（即使用户覆写了 supervisor/user 这类
          // builtin id，也应该作为 stone 出现，以便走 override 链）。
          // 只有 builtin 扫描路径需要走 BUILTIN_OBJECT_IDS 白名单，防止 node_modules 里的意外目录被纳入。
          if (kind === "builtin" && !BUILTIN_OBJECT_IDS.has(finalId) && !finalId.startsWith("_builtin/")) {
            // skip non-whitelist ids in builtin scan
          } else {
            stones.set(finalId, {
              objectId: finalId,
              kind: finalKind,
              dir: currentDir,
              packageJson: pkg,
              oocMetadata: ooc,
              mtime: statInfo.mtimeMs ?? 0,
            });
          }
        }
      }
    }

    // 递归子目录
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".")) continue;
      if (e.name === STONE_CHILDREN_SUBDIR) {
        // children/ 下的每一个子目录都是嵌套 stone
        const childrenDir = join(currentDir, STONE_CHILDREN_SUBDIR);
        let childEntries;
        try {
          childEntries = await readdir(childrenDir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const ce of childEntries) {
          if (!ce.isDirectory() || ce.name.startsWith(".")) continue;
          await walk(join(childrenDir, ce.name), [...idSegments, ce.name]);
        }
      } else if (idSegments.length === 0) {
        // 顶层子目录 —— 进入下一层
        await walk(join(currentDir, e.name), [e.name]);
      }
    }
  }

  await walk(rootDir, []);
}

export function createStoneRegistry(
  worldPath: string,
  opts: { autoDiscover?: boolean } = {},
): StoneRegistry {
  const auto = opts.autoDiscover ?? true;
  const stones = new Map<string, StoneDefinition>();
  const listeners = new Set<Listener>();

  async function rescan(): Promise<void> {
    stones.clear();
    // Flat layout: stones/<objectId>/
    await scanTree(join(worldPath, "stones"), "stone", stones);
    // Versioning worktree layout: stones/<branch>/objects/<objectId>/
    try {
      const stonesEntries = await readdir(join(worldPath, "stones"), { withFileTypes: true });
      for (const e of stonesEntries) {
        if (!e.isDirectory() || e.name.startsWith(".")) continue;
        if (e.name.startsWith("@")) continue;
        const objectsDir = join(worldPath, "stones", e.name, "objects");
        try {
          await scanTree(objectsDir, "stone", stones);
        } catch {
          // branch with no objects/ subdir — ignore
        }
      }
    } catch {
      // stones/ doesn't exist — fine
    }
    // Deprecated packages/ layout
    await scanTree(join(worldPath, "packages"), "stone", stones);
    await scanTree(join(worldPath, "node_modules", "@ooc", "builtins"), "builtin", stones);
  }

  const list = (): StoneDefinition[] =>
    Array.from(stones.values()).sort((a, b) => a.objectId.localeCompare(b.objectId));

  const registry: StoneRegistry = {
    worldPath,
    getDef(objectId) {
      return stones.get(objectId);
    },
    list,
    listByKind(kind) {
      return list().filter((s) => s.kind === kind);
    },
    rescan,
    on(_event, listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async invalidate(objectId, files) {
      const existing = stones.get(objectId);
      if (existing) {
        try {
          const s = await stat(existing.dir);
          existing.mtime = s.mtimeMs;
        } catch {
          /* dir may have been deleted */
        }
      }
      const kind = classifyChange(files);
      const ev: StoneChangedEvent = { kind, objectId, files };
      for (const l of listeners) l(ev);
    },
  };

  if (auto) {
    // Kick off initial scan in the background. Callers can `await registry.rescan()` if they
    // need to block on discovery completion.
    void rescan().catch(() => { /* ignore scan failures; missing dirs are fine */ });
  }

  return registry;
}
