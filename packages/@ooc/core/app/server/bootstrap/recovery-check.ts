/**
 * Recovery 启动自检（U8）—— Server 启动时遍历 `stones/main/objects/` 下所有用户 Object，
 * 试加载它们的 `executable/index.ts`；任何 Object 加载失败则在 super session 创一条
 * `[recovery-needed]` PR-Issue（不带 prPayload，因为这不是元编程修改而是诊断信号），
 * 让 Supervisor 在自己的 super flow 中看到并决定是否触发 rollback（控制面 governance
 * 端点 `POST /api/runtime/stones/<id>/rollback`）。
 *
 * 不阻塞 server 启动：失败的 Object 仍在磁盘上，但被 worker 实质性跳过（loader
 * 在 worker 调用时再次抛错）。Supervisor 通过 PR-Issue 收到通知。
 *
 * 去重：以 (objectId, stone state hash) 为 key —— 同一 broken state 不重复开 issue
 * （同 title + 同 createdByObjectId 视为 dup）。
 *
 * 枚举走 StoneRegistry（canonical `stones/main/objects/` + versioning worktree，含 children/
 * 嵌套），只看 kind="stone"（用户/实例对象——builtin class 是框架代码，不受自我编程腐化）。
 * 扫描目标从 deprecated `<world>/packages/` 改回 canonical，并随 packages/ 兼容层移除
 * 修正文件名 `server/index.ts → executable/index.ts`（已重命名）。
 */

import {
  createRecoveryIssue,
  readPrIssueIndex,
  readExecutableSource,
  type PrIssueRecord,
} from "@ooc/core/persistable";
import { loadStoneClass } from "@ooc/core/runtime/server-loader";
import { createStoneRegistry } from "@ooc/core/runtime/stone-registry";

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
  // canonical 枚举：StoreRegistry 扫 stones/main/objects/（含 children/ 嵌套）+ versioning 镜像。
  // 只校验 kind="stone"（用户/实例对象）——builtin class 是框架代码，不在自我编程恢复范围内。
  const registry = createStoneRegistry(opts.baseDir, { autoDiscover: false });
  await registry.rescan();
  const stones = registry.listByKind("stone");

  const broken: BrokenObject[] = [];
  for (const def of stones) {
    const stoneRef = { baseDir: opts.baseDir, objectId: def.objectId };
    // 只校验有 executable/index.ts 的 Object（绝大多数 stone 没有可执行方法）。
    // readExecutableSource 双读：优先 executable/，fallback legacy server/。
    let source: string | undefined;
    try {
      source = await readExecutableSource(stoneRef);
    } catch {
      source = undefined;
    }
    if (!source) continue;
    try {
      // load-detection：import 该 stone 的 `export const Class`（坏 import / 语法错误会 throw）。
      await loadStoneClass(stoneRef);
    } catch (err) {
      broken.push({
        objectId: def.objectId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 列出 super session 既有 PR-Issues，做去重
  const existingTitles = new Set<string>();
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
    // Supervisor 在自己的 super flow 看到后决定走控制面 rollback 端点。
    let issue: PrIssueRecord | undefined;
    try {
      issue = await createRecoveryIssue({
        baseDir: opts.baseDir,
        title,
        description: `Server startup self-check failed to load stones/main/objects/${b.objectId}/executable/index.ts.\n\nReason:\n${b.reason}\n\nSupervisor: consider rollback via 控制面 governance 端点 \`POST /api/runtime/stones/<id>/rollback\` to a previous commit, or directly fix the stone.`,
        createdByObjectId: "supervisor",
      });
    } catch {
      // supervisor 不存在或其它故障 —— 跳过本次，不阻塞启动
      continue;
    }
    if (issue) newIssues.push(issue.id);
  }

  return { scanned: stones.length, broken, newIssues };
}
