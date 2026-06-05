/**
 * evolve_self —— super-flow 身份合入闸门（design §4）。
 *
 * 把「某业务 session 的 overlay 试验改动」正式合入 canonical main：
 *   1. **diff 模式**：列出 creator session overlay 相对 main 改了哪些 stone 文件。
 *   2. **合入模式**：从 main 建实验 worktree（复用 versionedStoneWrite 的
 *      openMetaprogWorktree→write→commit→tryMergeSelf 流程），把选定 overlay 文件
 *      应用进 worktree，self-scope ff-merge 回 main，返回 commitSha。
 *
 * 设计契合：overlay 改的是 Object 自己 stone 自治区的文件 → tryMergeSelf 判为
 * self-scope → ff-merge 到 main，author = objectId（非 bootstrap）。冲突 / 越界
 * 由 versionedStoneWrite 的失败路径上抛，overlay 保留、main 不变（fail-loud）。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  listOverlayFiles,
  overlayStoneFilePath,
} from "../persistable/session-overlay.js";
import { nestedObjectPath } from "../persistable/common.js";
import { versionedStoneWrite } from "./versioned-write.js";

export interface EvolveSelfDiff {
  ok: true;
  kind: "diff";
  /** 该 session overlay 下改过的 stone 文件（relWithinObject，如 self.md / executable/index.ts）。 */
  files: string[];
}

export interface EvolveSelfMerged {
  ok: true;
  kind: "merged";
  /** merge 回 main 后的 commit sha。 */
  commitSha: string;
  /** 是否真正 ff-merge 到 main（self-scope）；cross-scope 时 false（理论上 overlay 全在自治区）。 */
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
  /** 提供 overlay 的业务 session（thread.creatorSessionId）。 */
  creatorSessionId: string;
  /** commit message。 */
  message: string;
  /** 选定要合入的文件（relWithinObject）；缺省=overlay 下全部。 */
  files?: string[];
}

/**
 * diff 模式：列出 creator session overlay vs main 改了哪些 stone 文件。
 * （overlay 文件即「session 内改过的」；与 main 的逐字节 diff 留给 UI/后续，此处给文件名集合。）
 */
export async function evolveSelfDiff(
  baseDir: string,
  objectId: string,
  creatorSessionId: string,
): Promise<EvolveSelfDiff> {
  const files = await listOverlayFiles(baseDir, creatorSessionId, objectId);
  return { ok: true, kind: "diff", files };
}

/**
 * 合入模式：把 overlay 文件应用进 main（经 versioned worktree）。
 *
 * 失败（冲突 / git 错 / 无文件）→ EvolveSelfErr，overlay 保留、main 不变。
 */
export async function evolveSelfMerge(
  input: EvolveSelfInput,
): Promise<EvolveSelfMerged | EvolveSelfErr> {
  const all = await listOverlayFiles(input.baseDir, input.creatorSessionId, input.objectId);
  const selected = input.files && input.files.length > 0
    ? input.files.filter((f) => all.includes(f))
    : all;

  if (selected.length === 0) {
    return {
      ok: false,
      code: "NO_OVERLAY",
      message:
        input.files && input.files.length > 0
          ? `选定文件均不在 session '${input.creatorSessionId}' 的 overlay 中（可用：${all.join(", ") || "无"}）。`
          : `session '${input.creatorSessionId}' 没有 overlay 改动可合入。`,
    };
  }

  const objectPrefix = nestedObjectPath(input.objectId).join("/");

  const versioned = await versionedStoneWrite({
    baseDir: input.baseDir,
    authorObjectId: input.objectId,
    intent: input.message,
    write: async (wt) => {
      for (const rel of selected) {
        const src = overlayStoneFilePath(
          input.baseDir,
          input.creatorSessionId,
          input.objectId,
          rel,
        );
        const content = await readFile(src, "utf8");
        const target = join(wt.path, "objects", objectPrefix, ...rel.split("/").filter(Boolean));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
      }
    },
  });

  if (!versioned.ok) {
    return { ok: false, code: versioned.code, message: versioned.message };
  }

  return {
    ok: true,
    kind: "merged",
    commitSha: versioned.commitSha,
    merged: versioned.merged,
    files: selected,
    prIssueId: versioned.prIssueId,
  };
}
