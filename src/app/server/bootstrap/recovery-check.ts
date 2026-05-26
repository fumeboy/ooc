/**
 * Recovery 启动自检（U8）—— Server 启动时遍历 `stones/main/objects/` 下所有 Object 目录，
 * 试加载它们的 `server/index.ts`；任何 Object 加载失败则在 super session 创一条
 * `[recovery-needed]` PR-Issue（不带 prPayload，因为这不是元编程修改而是诊断信号），
 * 让 Supervisor 在自己的 super flow 中看到并决定是否触发 metaprog rollback。
 *
 * 不阻塞 server 启动：失败的 Object 仍在磁盘上，但被 worker 实质性跳过（loader
 * 在 worker 调用时再次抛错）。Supervisor 通过 PR-Issue 收到通知。
 *
 * 去重：以 (objectId, stone state hash) 为 key —— 同一 broken state 不重复开 issue
 * （同 title + 同 createdByObjectId 视为 dup）。
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  STONES_MAIN_BRANCH,
  STONE_OBJECTS_SUBDIR,
  createRecoveryIssue,
  readPrIssueIndex,
  type PrIssueRecord,
} from "@src/persistable";
import { loadObjectWindow } from "@src/executable/server/loader";

const RECOVERY_PREFIX = "[recovery-needed]";

export interface RecoveryCheckResult {
  /** 检查的 Object 数量。 */
  scanned: number;
  /** 发现 broken 的 Object id 列表。 */
  broken: BrokenObject[];
  /** 本次新创建的 PR-Issue id（不含已存在的 dup）。 */
  newIssues: number[];
}

export interface BrokenObject {
  objectId: string;
  reason: string;
}

/**
 * 主入口。idempotent：重复运行不重复开 issue。
 */
export async function runRecoveryCheck(opts: { baseDir: string }): Promise<RecoveryCheckResult> {
  const stonesObjectsDir = join(opts.baseDir, "stones", STONES_MAIN_BRANCH, STONE_OBJECTS_SUBDIR);
  let entries: { name: string; isDir: boolean }[] = [];
  try {
    const dir = await readdir(stonesObjectsDir, { withFileTypes: true });
    entries = dir
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, isDir: true }));
  } catch {
    return { scanned: 0, broken: [], newIssues: [] };
  }

  const broken: BrokenObject[] = [];
  for (const e of entries) {
    const stoneRef = { baseDir: opts.baseDir, objectId: e.name, stonesBranch: STONES_MAIN_BRANCH };
    try {
      // 试加载 server/index.ts；不存在/空文件视为正常（绝大多数 stone 没有 server 方法）
      const serverFile = join(stonesObjectsDir, e.name, "server", "index.ts");
      try {
        await stat(serverFile);
      } catch {
        continue;
      }
      await loadObjectWindow(stoneRef);
    } catch (err) {
      broken.push({
        objectId: e.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 列出 super session 既有 PR-Issues，做去重
  let existingTitles = new Set<string>();
  try {
    const index = await readPrIssueIndex(opts.baseDir);
    for (const entry of index.issues) {
      if (entry.status === "open" && entry.title.startsWith(RECOVERY_PREFIX)) {
        existingTitles.add(entry.title);
      }
    }
  } catch {
    // index 不存在 → 还没有任何 super-session issue，空集即可
  }

  const newIssues: number[] = [];
  for (const b of broken) {
    const title = `${RECOVERY_PREFIX} ${b.objectId} stone unloadable`;
    if (existingTitles.has(title)) continue;

    // recovery-needed 是诊断信号（无 diff/branch），用 createRecoveryIssue 落到 super session。
    // Supervisor 在自己的 super flow 看到后决定走 metaprog rollback。
    let issue: PrIssueRecord | undefined;
    try {
      issue = await createRecoveryIssue({
        baseDir: opts.baseDir,
        title,
        description: `Server startup self-check failed to load stones/main/objects/${b.objectId}/server/index.ts.\n\nReason:\n${b.reason}\n\nSupervisor: consider \`metaprog rollback\` to a previous commit, or directly fix the stone.`,
        createdByObjectId: "supervisor",
      });
    } catch {
      // supervisor 不存在或其它故障 —— 跳过本次，不阻塞启动
      continue;
    }
    if (issue) newIssues.push(issue.id);
  }

  return { scanned: entries.length, broken, newIssues };
}
