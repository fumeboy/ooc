/**
 * Stone identity 的 session-worktree 访问层（2026-06-06，worktree 统一模型核心原语）。
 *
 * 设计见 docs/2026-06-05-stone-flow-overlay-versioning-design.md（worktree 模型）：
 * - business flow session 改 identity → 从 main lazy 派生一个 git worktree 分支
 *   `session-<sid>`（完整工作副本，复用 stones bare repo），读写都指向它。
 * - super flow / 控制面 → 直接 main canonical。
 *
 * 取代 plain overlay（session-overlay.ts）：worktree 是完整副本，读不需 shadow、裸读
 * （program shell $OOC_SELF_DIR）看得到完整 identity、读写都收敛到「一个目录」。
 *
 * 本文件只负责「解析 identity 目录 + lazy 建/检测 worktree」——不碰 commit/merge
 * （那是 super flow evolve_self 的事，复用 programmable/versioning）。
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, STONES_MAIN_BRANCH, STONES_BARE_REPO_DIR, type StoneObjectRef } from "./common";
import { gitWorktreeAdd } from "../programmable/git";
import { SUPER_SESSION_ID } from "../_shared/types/constants";

const SESSION_BRANCH_PREFIX = "session-";

/** business session 的 stone 分支名：`session-<sid>`。 */
export function sessionStoneBranch(sessionId: string): string {
  return `${SESSION_BRANCH_PREFIX}${sessionId}`;
}

/** stones bare repo 目录：`<baseDir>/stones/.stones_repo`。 */
function stonesBareRepoDir(baseDir: string): string {
  return join(baseDir, "stones", STONES_BARE_REPO_DIR);
}

/** session worktree 在磁盘的路径：`<baseDir>/stones/session-<sid>`（与 `_stonesBranch` 布局对齐）。 */
export function sessionWorktreePath(baseDir: string, sessionId: string): string {
  return join(baseDir, "stones", sessionStoneBranch(sessionId));
}

/**
 * 该 session 是否走 worktree（business session 才走；super / 控制面 / 无 session 直接 main）。
 * 与 session-overlay.sessionUsesOverlay 同款判定，便于平滑切换。
 */
export function sessionUsesWorktree(sessionId: string | undefined): boolean {
  if (!sessionId) return false;
  if (sessionId === SUPER_SESSION_ID) return false;
  return true;
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
 * lazy 建 session worktree（从 main HEAD 派生 `session-<sid>` 分支的完整 checkout）。
 * 幂等：已存在（含并发 WORKTREE_EXISTS）视为成功。失败 warn 并返回 false（caller 兜底 main）。
 */
export async function ensureSessionWorktree(baseDir: string, sessionId: string): Promise<boolean> {
  const wtPath = sessionWorktreePath(baseDir, sessionId);
  if (await pathExists(wtPath)) return true;
  const r = gitWorktreeAdd(stonesBareRepoDir(baseDir), {
    path: wtPath,
    branch: sessionStoneBranch(sessionId),
    baseRef: STONES_MAIN_BRANCH,
  });
  if (r.ok) return true;
  if (r.code === "WORKTREE_EXISTS") return true; // 并发首次写 → 一个赢、其余幂等
  console.warn(
    `[stone-worktree] ensureSessionWorktree failed sid=${sessionId}: ${r.stderr ?? r.code}`,
  );
  return false;
}

/**
 * worktree 模型的统一 identity 目录解析（读写同一个目录，无 shadow）。
 *
 * - super / 控制面 / 无 session → main canonical。
 * - business session：
 *   - mode=write → lazy 建 worktree，返回 worktree 内 object dir（写落 worktree）。
 *   - mode=read → 已建 worktree 则读它（完整副本）；未建则透传 main（绝大多数不碰 identity 的读）。
 *   - 建 worktree 失败 → 兜底 main（warn 已发，不静默）。
 *
 * 所有 identity 访问通道（write_file / loader / loadSelfInstructions / program shell
 * $OOC_SELF_DIR / 控制面 visible endpoint）都应过本函数，结构上杜绝再漏接。
 */
export async function resolveStoneIdentityDir(
  ref: { baseDir: string; sessionId?: string; objectId: string },
  mode: "read" | "write",
): Promise<string> {
  return stoneDir(await resolveStoneIdentityRef(ref, mode));
}

/**
 * `resolveStoneIdentityDir` 的 ref 版：返回完整 `StoneObjectRef`，business session
 * 命中 worktree 时带 `_stonesBranch="session-<sid>"`（否则裸 main ref）。
 *
 * 给 **ref-based 通道**用（loadSelfInstructions / ServerLoader feed / program shell）：
 * 这些通道下游靠 `stoneDir(ref)` / `readSelf(ref)` 路由，传 worktree-aware ref 即可让
 * 它们整体读 worktree 完整副本，无需各自手拼路径。路由语义与 `resolveStoneIdentityDir`
 * 完全一致（同一实现）。
 */
export async function resolveStoneIdentityRef(
  ref: { baseDir: string; sessionId?: string; objectId: string },
  mode: "read" | "write",
): Promise<StoneObjectRef> {
  const { baseDir, sessionId, objectId } = ref;
  const mainRef: StoneObjectRef = { baseDir, objectId };
  if (!sessionUsesWorktree(sessionId)) return mainRef;

  const wtPath = sessionWorktreePath(baseDir, sessionId!);
  let ready = await pathExists(wtPath);
  if (!ready) {
    if (mode === "read") return mainRef; // 未建且只读 → 透传 main
    ready = await ensureSessionWorktree(baseDir, sessionId!); // 写 → lazy 建
    if (!ready) return mainRef; // 建失败兜底
  }
  return { baseDir, objectId, _stonesBranch: sessionStoneBranch(sessionId!) };
}
