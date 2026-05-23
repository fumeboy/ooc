/**
 * 一次性迁移命令 —— 把存量 `stones/<branch>/objects/<id>/{knowledge,files}` 迁到
 * `pools/objects/<id>/{knowledge,files}`（2026-05-23 三分重组）。
 *
 * 设计原则（meta/object.doc.ts persistable.stone.todo / persistable.pool.todo）:
 * - 不在 server 启动时自动跑（CLAUDE.md "不悄悄做"）。
 * - 只复制不删除 stone 侧旧数据；用户确认无误后自行 `git rm` + commit 真正脱钩。
 * - 旧 stone 层 data.json 不迁（语义已变为 session-scoped；跨 session stone 级载体不再存在）。
 * - 报告每个 object 的 source / target 大小 + 是否成功，便于人工核对。
 *
 * 调用方式（接到 CLI 后通过 `bun run` 入口转发）：
 *
 *   await migrateStoneKnowledgeToPool({ baseDir: "/abs/.ooc-world" });
 *
 * 也支持 dryRun=true 只产报告不写盘。
 */

import { mkdir, readdir, stat, copyFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, relative } from "node:path";
import { STONES_MAIN_BRANCH, STONE_OBJECTS_SUBDIR } from "@src/persistable";
import {
  poolDir,
  poolKnowledgeDir,
  poolFilesDir,
  poolMetadataFile,
  POOL_OBJECTS_SUBDIR,
  type PoolObjectRef,
} from "@src/persistable/pool-object";
import { writeFile } from "node:fs/promises";

export interface MigrateOptions {
  /** 包含 stones/ 与 pools/ 的根目录。 */
  baseDir: string;
  /** 仅扫描特定分支（默认 main + 探测出来的 metaprog 分支也跳过）。 */
  branch?: string;
  /** 只输出报告不写盘。默认 false。 */
  dryRun?: boolean;
}

export interface MigrateObjectReport {
  objectId: string;
  branch: string;
  knowledge: {
    sourceExists: boolean;
    sourceBytes: number;
    targetBytes: number;
    copiedFiles: number;
    copied: boolean;
    error?: string;
  };
  files: {
    sourceExists: boolean;
    sourceBytes: number;
    targetBytes: number;
    copiedFiles: number;
    copied: boolean;
    error?: string;
  };
}

export interface MigrateReport {
  baseDir: string;
  dryRun: boolean;
  objects: MigrateObjectReport[];
  hint: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function dirSize(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  async function walk(p: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(p, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const e of entries) {
      const full = join(p, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        const s = await stat(full);
        bytes += s.size;
        files += 1;
      }
    }
  }
  await walk(dir);
  return { bytes, files };
}

async function copyTree(srcRoot: string, dstRoot: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  async function walk(srcDir: string, dstDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(srcDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await mkdir(dstDir, { recursive: true });
    for (const e of entries) {
      const srcPath = join(srcDir, e.name);
      const dstPath = join(dstDir, e.name);
      if (e.isDirectory()) {
        await walk(srcPath, dstPath);
      } else if (e.isFile()) {
        // 不覆盖目标已有文件——避免误盖用户在 pool 层已修改过的版本
        if (await pathExists(dstPath)) continue;
        await copyFile(srcPath, dstPath);
        const s = await stat(dstPath);
        bytes += s.size;
        files += 1;
      }
    }
  }
  await walk(srcRoot, dstRoot);
  return { bytes, files };
}

async function listBranches(baseDir: string): Promise<string[]> {
  const stonesDir = join(baseDir, "stones");
  let entries;
  try {
    entries = await readdir(stonesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);
}

async function listObjects(baseDir: string, branch: string): Promise<string[]> {
  const objectsDir = join(baseDir, "stones", branch, STONE_OBJECTS_SUBDIR);
  let entries;
  try {
    entries = await readdir(objectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);
}

async function ensurePoolMetadata(ref: PoolObjectRef): Promise<void> {
  const metaFile = poolMetadataFile(ref);
  if (await pathExists(metaFile)) return;
  await mkdir(poolDir(ref), { recursive: true });
  const meta = { type: "pool" as const, objectId: ref.objectId };
  await writeFile(metaFile, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

/**
 * 主入口：扫描 baseDir 下所有 stones 分支的 objects/，把 knowledge/ 和 files/
 * 子树拷贝到 pools/objects/<id>/。
 */
export async function migrateStoneKnowledgeToPool(opts: MigrateOptions): Promise<MigrateReport> {
  const baseDir = opts.baseDir;
  const dryRun = opts.dryRun ?? false;
  const branches = opts.branch ? [opts.branch] : await listBranches(baseDir);

  const objects: MigrateObjectReport[] = [];

  for (const branch of branches) {
    const ids = await listObjects(baseDir, branch);
    for (const objectId of ids) {
      const stoneObjectDir = join(baseDir, "stones", branch, STONE_OBJECTS_SUBDIR, objectId);
      const stoneKnowledgeSrc = join(stoneObjectDir, "knowledge");
      const stoneFilesSrc = join(stoneObjectDir, "files");

      const poolRef: PoolObjectRef = { baseDir, objectId };
      const poolKnowledgeDst = poolKnowledgeDir(poolRef);
      const poolFilesDst = poolFilesDir(poolRef);

      const knowledgeSourceExists = await pathExists(stoneKnowledgeSrc);
      const filesSourceExists = await pathExists(stoneFilesSrc);
      const knowledgeSourceSize = knowledgeSourceExists
        ? await dirSize(stoneKnowledgeSrc)
        : { bytes: 0, files: 0 };
      const filesSourceSize = filesSourceExists ? await dirSize(stoneFilesSrc) : { bytes: 0, files: 0 };

      const report: MigrateObjectReport = {
        objectId,
        branch,
        knowledge: {
          sourceExists: knowledgeSourceExists,
          sourceBytes: knowledgeSourceSize.bytes,
          targetBytes: 0,
          copiedFiles: 0,
          copied: false,
        },
        files: {
          sourceExists: filesSourceExists,
          sourceBytes: filesSourceSize.bytes,
          targetBytes: 0,
          copiedFiles: 0,
          copied: false,
        },
      };

      if (!knowledgeSourceExists && !filesSourceExists) {
        objects.push(report);
        continue;
      }

      if (!dryRun) {
        await ensurePoolMetadata(poolRef);
      }

      if (knowledgeSourceExists) {
        try {
          if (!dryRun) {
            const r = await copyTree(stoneKnowledgeSrc, poolKnowledgeDst);
            report.knowledge.targetBytes = r.bytes;
            report.knowledge.copiedFiles = r.files;
          } else {
            report.knowledge.targetBytes = knowledgeSourceSize.bytes;
            report.knowledge.copiedFiles = knowledgeSourceSize.files;
          }
          report.knowledge.copied = true;
        } catch (e) {
          report.knowledge.error = (e as Error).message;
        }
      }

      if (filesSourceExists) {
        try {
          if (!dryRun) {
            const r = await copyTree(stoneFilesSrc, poolFilesDst);
            report.files.targetBytes = r.bytes;
            report.files.copiedFiles = r.files;
          } else {
            report.files.targetBytes = filesSourceSize.bytes;
            report.files.copiedFiles = filesSourceSize.files;
          }
          report.files.copied = true;
        } catch (e) {
          report.files.error = (e as Error).message;
        }
      }

      objects.push(report);
    }
  }

  const hint =
    "Migration only copies (not removes) stone-side knowledge/ + files/. " +
    "After verifying pool data integrity, manually `git rm -r stones/<branch>/objects/<id>/{knowledge,files}` " +
    "in each stone worktree and commit to detach for real.";

  return { baseDir, dryRun, objects, hint };
}

/**
 * CLI 入口（通过 `bun run src/app/server/bootstrap/migrate-stone-knowledge-to-pool.ts --world ...`
 * 直接调用）。
 *
 * 与 server 启动严格分离：本入口只做迁移 + 输出报告，然后退出。
 */
export async function runMigrateCli(argv: string[]): Promise<number> {
  const baseIdx = argv.findIndex((a) => a === "--world" || a === "--world-dir" || a === "--base-dir");
  let baseDir: string | undefined;
  if (baseIdx >= 0 && baseIdx + 1 < argv.length) {
    baseDir = argv[baseIdx + 1];
  } else {
    const eq = argv.find((a) => a.startsWith("--world=") || a.startsWith("--world-dir=") || a.startsWith("--base-dir="));
    if (eq) baseDir = eq.split("=").slice(1).join("=");
  }
  if (!baseDir) {
    console.error("Usage: bun run migrate-stone-knowledge-to-pool --world <baseDir> [--dry-run] [--branch <name>]");
    return 2;
  }
  const dryRun = argv.includes("--dry-run");
  const branchIdx = argv.findIndex((a) => a === "--branch");
  const branch = branchIdx >= 0 && branchIdx + 1 < argv.length ? argv[branchIdx + 1] : undefined;

  const report = await migrateStoneKnowledgeToPool({ baseDir, dryRun, branch });

  console.log(`# migrate-stone-knowledge-to-pool report`);
  console.log(`baseDir: ${report.baseDir}`);
  console.log(`dryRun: ${report.dryRun}`);
  console.log(`branches considered: ${branch ?? "(all)"}`);
  console.log(`objects scanned: ${report.objects.length}`);
  for (const o of report.objects) {
    const k = o.knowledge;
    const f = o.files;
    console.log(
      `- ${o.branch}/${o.objectId}: ` +
        `knowledge[src=${k.sourceExists ? `${k.sourceBytes}B` : "-"} / dst=${k.copiedFiles}f ${k.targetBytes}B / copied=${k.copied}${k.error ? ` ERR:${k.error}` : ""}] ` +
        `files[src=${f.sourceExists ? `${f.sourceBytes}B` : "-"} / dst=${f.copiedFiles}f ${f.targetBytes}B / copied=${f.copied}${f.error ? ` ERR:${f.error}` : ""}]`,
    );
  }
  console.log("");
  console.log(report.hint);
  return 0;
}

// ESM/CJS 通用：仅在被直接 `bun run` 时运行 CLI；被其它模块 import 时不副作用。
if (typeof Bun !== "undefined" && import.meta.main) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runMigrateCli(process.argv.slice(2)).then((code: number) => process.exit(code));
}
