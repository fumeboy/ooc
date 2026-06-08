/**
 * Stone identity 的 session-worktree 访问层（2026-06-06，worktree 统一模型核心原语）。
 *
 * 设计见 docs/2026-06-09-remove-metaprog-unify-session-worktree-design.md §1bis（方案 A）：
 * - business flow session = 从 main 派生的 git worktree 分支 `session-<sid>`，物理落
 *   `flows/<sid>`（eager：session 创建即 worktree add 全量 checkout main），读写都指向它。
 *   运行时数据与 tracked stone 文件共存此目录，靠 main .gitignore 排除运行时产物。
 * - super flow / 控制面 → 直接 main canonical（super 不建 worktree）。
 *
 * 取代旧 plain overlay 模型：worktree 是完整副本，读不需 shadow、裸读
 * （program shell $OOC_SELF_DIR）看得到完整 identity、读写都收敛到「一个目录」。
 *
 * 本文件只负责「解析 identity 目录 + lazy 建/检测 worktree」——不碰 commit/merge
 * （那是 super flow evolve_self 的事，复用 programmable/versioning）。
 */

import { readdir, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  stoneDir,
  STONES_MAIN_BRANCH,
  STONES_BARE_REPO_DIR,
  SESSION_BRANCH_PREFIX,
  type StoneObjectRef,
} from "./common";
import { gitWorktreeAdd } from "../programmable/git";
import { SUPER_SESSION_ID } from "../_shared/types/constants";

/** business session 的 stone 分支名：`session-<sid>`。 */
export function sessionStoneBranch(sessionId: string): string {
  return `${SESSION_BRANCH_PREFIX}${sessionId}`;
}

/** stones bare repo 目录：`<baseDir>/stones/.stones_repo`。 */
function stonesBareRepoDir(baseDir: string): string {
  return join(baseDir, "stones", STONES_BARE_REPO_DIR);
}

/**
 * session worktree 在磁盘的路径：`<baseDir>/flows/<sid>`（方案 A，2026-06-09）。
 *
 * `flows/<sid>` 目录本身即从 `stones/main` 派生的 git worktree（branch 名仍是
 * `session-<sid>`，与物理路径解耦）。运行时数据（.session.json / .flow.json /
 * threads/ / context.json …）与 tracked stone 文件（`objects/`）共存此目录，靠 main
 * 分支根的 .gitignore（白名单 `objects/`、排除其余顶层）把运行时产物排除出 git。
 */
export function sessionWorktreePath(baseDir: string, sessionId: string): string {
  return join(baseDir, "flows", sessionId);
}

/**
 * 该 session 是否走 worktree（business session 才走；super / 控制面 / 无 session 直接 main）。
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
 * 该 `flows/<sid>` 目录是否已是一个 git worktree（含 worktree link 文件 `.git`）。
 *
 * 方案 A 下 `flows/<sid>` 与运行时数据共存：单纯 pathExists 不足以判定 worktree 已建
 * （可能只是 createFlowSession 先 mkdir 出的空目录）。判 `.git` 才是真 worktree 信号。
 */
async function isSessionWorktree(wtPath: string): Promise<boolean> {
  return pathExists(join(wtPath, ".git"));
}

/**
 * 建 session worktree（从 main HEAD 派生 `session-<sid>` 分支的完整 checkout，物理落
 * `flows/<sid>`）。方案 A（2026-06-09）改 eager：session 创建入口先调本函数再写运行时数据。
 *
 * 幂等：已是 worktree（含并发 WORKTREE_EXISTS）视为成功。
 *
 * `git worktree add` 要求目标空目录：若 `flows/<sid>` 已存在但非 worktree（尚无 `.git`），
 * 尝试 rmdir（仅当空时成功）让 add 能创建；非空则让 add 自行报错（fail-loud 给 caller）。
 * 失败 warn 并返回 false——business session caller 据此 fail-loud（决策 4）。
 */
export async function ensureSessionWorktree(baseDir: string, sessionId: string): Promise<boolean> {
  const wtPath = sessionWorktreePath(baseDir, sessionId);
  if (await isSessionWorktree(wtPath)) return true;
  // 目标已存在但非 worktree（如 createFlowSession 先 mkdir 的空目录）：尝试清空目录让
  // git worktree add 能创建。仅当空时 rmdir 成功；非空（已写运行时数据）则 add 会报错。
  if (await pathExists(wtPath)) {
    try {
      const entries = await readdir(wtPath);
      if (entries.length === 0) await rmdir(wtPath);
    } catch {
      // 读/删失败：交给 git worktree add 报错（fail-loud），不在此静默吞。
    }
  }
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
  // 方案 A 下 `flows/<sid>` 与运行时数据共存——必须判 `.git`（真 worktree 信号），不能只判
  // 目录存在（可能只是 createFlowSession 先 mkdir 的空目录 / 纯运行时目录）。
  let ready = await isSessionWorktree(wtPath);
  if (!ready) {
    if (mode === "read") return mainRef; // 未建 worktree 且只读 → 透传 main
    ready = await ensureSessionWorktree(baseDir, sessionId!); // 写 → 建 worktree
    if (!ready) return mainRef; // 建失败兜底（business session 入口已 eager 建，正常不到这）
  }
  return { baseDir, objectId, _stonesBranch: sessionStoneBranch(sessionId!) };
}
