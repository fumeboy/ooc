/**
 * stone-versioning — P2 STUB
 *
 * 此文件是 ooc-3 P2 阶段的占位 stub。
 * 原 ooc-2 实现依赖旧 Window 模型辅助函数（stone-object/stone-self/stone-readme/pr-issue）
 * 这些在 ooc-3 归一化架构下将被重新设计；P2 阶段先用 stub 保持 tsc 通过。
 *
 * _todo: P8+ implement properly as part of programmable/metaprog dimension.
 * All exported functions throw at runtime. Only `pruneStaleWorktrees` is a safe
 * no-op (called in stone-bootstrap under try/catch).
 */

export const SUPERVISOR_OBJECT_ID = "supervisor";

export interface MetaprogWorktreeRef {
    baseDir: string;
    objectId: string;
    branch: string;
    path: string;
    baseCommit: string;
}

export interface OpenMetaprogWorktreeInput {
    baseDir: string;
    objectId: string;
    token?: string;
}

export type OpenMetaprogWorktreeError =
    | { ok: false; code: string; message: string }

export type OpenMetaprogWorktreeResult =
    | { ok: true; worktree: MetaprogWorktreeRef }
    | OpenMetaprogWorktreeError;

export async function openMetaprogWorktree(
    _input: OpenMetaprogWorktreeInput,
): Promise<OpenMetaprogWorktreeResult> {
    throw new Error("stone-versioning: not yet implemented in ooc-3 (P2 stub)");
}

export interface CommitWorktreeInput {
    worktree: MetaprogWorktreeRef;
    intent: string;
    authorObjectId: string;
}

export type CommitWorktreeResult =
    | { ok: true; commitSha: string }
    | { ok: false; code: string; stderr?: string; gitCode?: string };

export async function commitWorktree(_input: CommitWorktreeInput): Promise<CommitWorktreeResult> {
    throw new Error("stone-versioning: not yet implemented in ooc-3 (P2 stub)");
}

export type TryMergeSelfResult =
    | { ok: true; kind: "merged"; commitSha: string }
    | { ok: true; kind: "must-pr-issue"; paths: string[] }
    | { ok: true; kind: "rebase-conflict"; stderr: string }
    | { ok: true; kind: "non-fast-forward"; stderr: string }
    | { ok: false; code: string; message?: string; stderr?: string; gitCode?: string };

export async function tryMergeSelf(
    _worktree: MetaprogWorktreeRef,
    _authorObjectId: string,
): Promise<TryMergeSelfResult> {
    throw new Error("stone-versioning: not yet implemented in ooc-3 (P2 stub)");
}

export interface RequestPrIssueInput {
    worktree: MetaprogWorktreeRef;
    intent: string;
    authorObjectId: string;
}

export type RequestPrIssueResult =
    | { ok: true; issueId: number }
    | { ok: false; code: string; message?: string };

export async function requestPrIssueReview(
    _input: RequestPrIssueInput,
): Promise<RequestPrIssueResult> {
    throw new Error("stone-versioning: not yet implemented in ooc-3 (P2 stub)");
}

export interface PruneResult {
    ok: boolean;
    removed: string[];
}

export async function pruneStaleWorktrees(_baseDir: string): Promise<PruneResult> {
    // no-op stub: advisory only, called from stone-bootstrap try/catch
    return { ok: true, removed: [] };
}
