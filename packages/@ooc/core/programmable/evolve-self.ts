/**
 * evolve_self —— super-flow 身份合入闸门（worktree 统一模型，design §4）。
 *
 * 把「某业务 session 的 worktree 改动」正式合入 canonical main：
 *   1. **diff 模式**：列出 creator session 的 worktree 工作树相对 HEAD 改了哪些 stone 文件
 *      （业务 session 的 write_file/edit 直写 worktree、未 commit）。
 *   2. **合入模式**：commit creator session 的 `session-<sid>` worktree（署名 = objectId）
 *      → rebase 到 main → self-scope ff-merge 回 main → GC（移除 worktree + 删分支）。
 *
 * 与旧 plain-overlay 模型的区别（doc §4）：**session 分支即演化单元**——不再读 overlay
 * 逐文件应用进新建实验 worktree，而是直接 commit+merge 业务 session 已有的 worktree 分支。
 *
 * 设计契合：worktree 改的是 Object 自己 stone 自治区的文件 → tryMergeSelf 判为 self-scope
 * → ff-merge 到 main，author = objectId（非 bootstrap）。冲突 / 越界由 tryMergeSelf 上抛，
 * worktree 保留、main 不变（fail-loud）。
 */

import {
  commitWorktree,
  requestPrIssueReview,
  tryMergeSelf,
  type MetaprogWorktreeRef,
} from "./versioning.js";
import { gitBranchDelete, gitStatus } from "./git.js";
import { nestedObjectPath, STONES_MAIN_BRANCH } from "../persistable/common.js";
import {
  sessionStoneBranch,
  sessionWorktreePath,
} from "../persistable/stone-worktree.js";
import { stat } from "node:fs/promises";
import { join } from "node:path";

export interface EvolveSelfDiff {
  ok: true;
  kind: "diff";
  /** 该 session worktree 下改过的 stone 文件（relWithinObject，如 self.md / executable/index.ts）。 */
  files: string[];
}

export interface EvolveSelfMerged {
  ok: true;
  kind: "merged";
  /** merge 回 main 后的 commit sha。 */
  commitSha: string;
  /** 是否真正 ff-merge 到 main（self-scope）；cross-scope 时 false。 */
  merged: boolean;
  /** 本次合入的文件。 */
  files: string[];
  /** cross-scope 落 PR-Issue 时的 id。 */
  prIssueId?: number;
}

export interface EvolveSelfErr {
  ok: false;
  code: string;
  message: string;
}

export interface EvolveSelfInput {
  baseDir: string;
  /** 要合入身份的 Object（= super flow 自身 objectId）。 */
  objectId: string;
  /** 提供 worktree 的业务 session（thread.creatorSessionId）。 */
  creatorSessionId: string;
  /** commit message。 */
  message: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 把 worktree `git status --porcelain` 的一行（如 ` M objects/agent/self.md` /
 * `?? objects/agent/new.ts`）转成相对 object stone 根的 relWithinObject（如 `self.md`）。
 * 不属于本 object 自治区前缀的行（理论上不该有——worktree 只装自己 identity）返回 undefined。
 */
function porcelainLineToRel(line: string, objectPrefix: string): string | undefined {
  // porcelain 格式：前两列是 XY status，第三列起是路径（有空格则从第 3 字符切）。
  const path = line.slice(3).trim();
  if (!path) return undefined;
  // 重命名 "old -> new" 取 new
  const real = path.includes(" -> ") ? path.split(" -> ")[1]!.trim() : path;
  const prefix = `objects/${objectPrefix}/`;
  if (!real.startsWith(prefix)) return undefined;
  return real.slice(prefix.length);
}

/**
 * diff 模式：列出 creator session worktree 工作树（vs HEAD）改了哪些 stone 文件。
 * worktree 未建（session 没改过 identity）→ 空数组。
 */
export async function evolveSelfDiff(
  baseDir: string,
  objectId: string,
  creatorSessionId: string,
): Promise<EvolveSelfDiff> {
  const wtPath = sessionWorktreePath(baseDir, creatorSessionId);
  if (!(await pathExists(wtPath))) return { ok: true, kind: "diff", files: [] };

  const status = gitStatus(wtPath);
  if (!status.ok) return { ok: true, kind: "diff", files: [] };

  const objectPrefix = nestedObjectPath(objectId).join("/");
  const files: string[] = [];
  for (const line of status.value.split("\n")) {
    if (!line.trim()) continue;
    const rel = porcelainLineToRel(line, objectPrefix);
    if (rel) files.push(rel);
  }
  return { ok: true, kind: "diff", files: files.sort() };
}

/**
 * 合入模式：commit creator session 的 worktree 分支 → merge main。
 *
 * 失败（无改动 / 冲突 / git 错）→ EvolveSelfErr，worktree 保留、main 不变。
 */
export async function evolveSelfMerge(
  input: EvolveSelfInput,
): Promise<EvolveSelfMerged | EvolveSelfErr> {
  const { baseDir, objectId, creatorSessionId, message } = input;
  const wtPath = sessionWorktreePath(baseDir, creatorSessionId);
  if (!(await pathExists(wtPath))) {
    return {
      ok: false,
      code: "NO_CHANGES",
      message: `业务 session '${creatorSessionId}' 没有 worktree 改动可合入（未建 worktree）。`,
    };
  }

  // diff（合入前快照，给返回值带 files；commit 后工作树清空）
  const diff = await evolveSelfDiff(baseDir, objectId, creatorSessionId);
  const branch = sessionStoneBranch(creatorSessionId);
  const worktree: MetaprogWorktreeRef = {
    baseDir,
    objectId,
    branch,
    path: wtPath,
    baseCommit: "",
  };

  // 1. commit 业务 session 在 worktree 里的改动（署名 objectId）
  const commit = await commitWorktree({ worktree, intent: message, authorObjectId: objectId });
  if (!commit.ok) {
    const stderr = "stderr" in commit ? commit.stderr : "";
    if (stderr.includes("nothing to commit")) {
      return {
        ok: false,
        code: "NO_CHANGES",
        message: `业务 session '${creatorSessionId}' 的 worktree 没有未提交改动可合入。`,
      };
    }
    return { ok: false, code: commit.code, message: "message" in commit ? commit.message : stderr };
  }

  // 2. rebase 到 main → 分类 → self-scope ff-merge 回 main → 移除 worktree
  const merge = await tryMergeSelf(worktree, objectId);
  if (!merge.ok) {
    return { ok: false, code: merge.code, message: "message" in merge ? merge.message : merge.stderr };
  }

  if (merge.kind === "merged") {
    // 3. GC：tryMergeSelf 已移除 worktree 目录；session 分支 ff 后等于 main，删之收尾。
    const del = gitBranchDelete(join(baseDir, "stones", STONES_MAIN_BRANCH), branch);
    if (!del.ok) {
      // silent-swallow ban：删分支失败不阻塞 merge 成功，但 warn 让运维知情。
      // eslint-disable-next-line no-console
      console.warn(`[evolve-self] session 分支 GC 失败 branch=${branch}: ${del.stderr}`);
    }
    return {
      ok: true,
      kind: "merged",
      commitSha: merge.commitSha,
      merged: true,
      files: diff.files,
    };
  }

  if (merge.kind === "must-pr-issue") {
    // 理论上 worktree 只装自己 identity（自治区），不该越界；防御性走 PR-Issue。
    const pr = await requestPrIssueReview({ worktree, intent: message, authorObjectId: objectId });
    if (!pr.ok) {
      return { ok: false, code: pr.code, message: "message" in pr ? pr.message : pr.stderr };
    }
    return {
      ok: true,
      kind: "merged",
      commitSha: commit.commitSha,
      merged: false,
      files: diff.files,
      prIssueId: pr.issueId,
    };
  }

  // rebase-conflict / non-fast-forward —— caller 应看到失败信号，worktree 保留。
  return {
    ok: false,
    code: merge.kind === "rebase-conflict" ? "REBASE_CONFLICT" : "NON_FAST_FORWARD",
    message: merge.stderr,
  };
}
