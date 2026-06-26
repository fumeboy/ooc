/**
 * Stone identity 的 session-worktree 访问层（worktree 统一模型核心原语）。
 *
 * 方案 A：
 * - business flow session = 从 main 派生的 git worktree 分支 `session-<sid>`，物理落
 *   `flows/<sid>`（eager：session 创建即 worktree add 全量 checkout main），读写都指向它。
 *   运行时数据与 tracked stone 文件共存此目录，靠 main .gitignore 排除运行时产物。
 * - super flow / 控制面 → 直接 main canonical（super 不建 worktree）。
 *
 * 取代旧 plain overlay 模型：worktree 是完整副本，读不需 shadow、裸读
 * （program shell $OOC_SELF_DIR）看得到完整 identity、读写都收敛到「一个目录」。
 *
 * 本文件只负责「解析 identity 目录 + lazy 建/检测 worktree」——不碰 commit/merge
 * （那是 super flow `create_pr_for_versioned` / `create_pr_for_class_edits` 的事，
 * 复用 stone-versioning）。
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
import { gitWorktreeAdd } from "./stone-git";
import { SUPER_SESSION_ID, isSuperSessionId } from "../types/constants";

/**
 * Internal symbol used by mergeFeatBranch / httpDirectMainWrite to bypass the
 * `mode:"write", ref:"main"` guard. **Do not export to userland**——只允许
 * persistable 内部少数受控入口持有。
 *
 * issue D `2026-06-26-reflectable-redesign-as-flow-dispatcher.md` 落地裁决 7。
 */
export const MERGE_FAST_FORWARD_INTERNAL: unique symbol = Symbol.for(
  "@ooc/core/persistable/stone-worktree/MERGE_FAST_FORWARD_INTERNAL",
);

/**
 * 业务 session 在非 super sessionId 下试图直写 stones/main 时抛出。
 *
 * 唯一合规路径：经 `talk(target="super")` 进 super flow，在 super session 内调
 * `create_pr_for_versioned` / `create_pr_for_class_edits` 走 feat-branch PR；
 * pool 沉淀走 `sediment_unversioned`。
 */
export class SuperSessionRequiredError extends Error {
  readonly code = "SUPER_SESSION_REQUIRED";
  constructor(message: string) {
    super(message);
    this.name = "SuperSessionRequiredError";
  }
}

/** business session 的 stone 分支名：`session-<sid>`。 */
export function sessionStoneBranch(sessionId: string): string {
  return `${SESSION_BRANCH_PREFIX}${sessionId}`;
}

/** stones bare repo 目录：`<baseDir>/stones/.stones_repo`。 */
function stonesBareRepoDir(baseDir: string): string {
  return join(baseDir, "stones", STONES_BARE_REPO_DIR);
}

/**
 * session worktree 在磁盘的路径：`<baseDir>/flows/<sid>`。
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
 * `flows/<sid>` 与运行时数据共存：单纯 pathExists 不足以判定 worktree 已建
 * （可能只是 createFlowSession 先 mkdir 出的空目录）。判 `.git` 才是真 worktree 信号。
 */
async function isSessionWorktree(wtPath: string): Promise<boolean> {
  return pathExists(join(wtPath, ".git"));
}

/**
 * 建 session worktree（从 main HEAD 派生 `session-<sid>` 分支的完整 checkout，物理落
 * `flows/<sid>`）。改 eager：session 创建入口先调本函数再写运行时数据。
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
 * feat 分支 worktree 物理落点：`<baseDir>/stones/<branch>/`（与 main / session worktree 并列）。
 * 与 stone-feat-branch.featWorktreePath 同实现（避免循环依赖，路径常量极简故本地化）。
 */
function featBranchWorktreePath(baseDir: string, branch: string): string {
  return join(baseDir, "stones", branch);
}

/**
 * 确保 feat 分支 worktree 已就绪（含 `.git` worktree link）。
 *
 * 沉淀流程下 feat worktree 由 super-flow PR 系 method（`create_pr_for_versioned` /
 * `create_pr_for_class_edits`）内部 eager 建好。绑定存在但 worktree 不在
 * （磁盘被清 / 异常）→ fail-loud warn，caller 兜底 main。**本函数不建分支**（建分支是
 * 上述 PR 系 method 的职责，需从 main 派生 + 串行化）。
 */
async function ensureFeatBranchWorktreeReady(baseDir: string, branch: string): Promise<boolean> {
  const wtPath = featBranchWorktreePath(baseDir, branch);
  if (await pathExists(join(wtPath, ".git"))) return true;
  console.warn(
    `[stone-worktree] feat-branch 绑定 '${branch}' 的 worktree 不存在（${wtPath}）；` +
      `经 talk(target="super") 后在 super flow 内调 create_pr_for_versioned / create_pr_for_class_edits 开 PR。兜底走 main。`,
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
  ref: { baseDir: string; sessionId?: string; objectId: string; stonesBranch?: string },
  mode: "read" | "write",
  __internal?: symbol,
): Promise<string> {
  return stoneDir(await resolveStoneIdentityRef(ref, mode, __internal));
}

/**
 * `resolveStoneIdentityDir` 的 ref 版：返回完整 `StoneObjectRef`，business session
 * 命中 worktree 时带 `_stonesBranch="session-<sid>"`（否则裸 main ref）。
 *
 * 给 **ref-based 通道**用（loadSelfInstructions / ServerLoader feed / program shell）：
 * 这些通道下游靠 `stoneDir(ref)` / `readSelf(ref)` 路由,传 worktree-aware ref 即可让
 * 它们整体读 worktree 完整副本，无需各自手拼路径。路由语义与 `resolveStoneIdentityDir`
 * 完全一致（同一实现）。
 *
 * **issue D 守卫**：`mode:"write", ref:"main"`（即 sessionId 缺省 / super / 非 feat branch
 * 解析到裸 main canonical）一律 throw `SuperSessionRequiredError`——业务 session 直写
 * main 是 reflectable 重设计后的偷渡路径，必须经 `talk(target="super")` 在 super flow
 * 内调 PR / sediment_unversioned method 走合规渠道。
 *
 * 唯一旁路：`mergeFeatBranch` / `httpDirectMainWrite` / `rollback` 等已决策入口持有
 * `MERGE_FAST_FORWARD_INTERNAL` symbol 显式跳闸。
 */
export async function resolveStoneIdentityRef(
  ref: { baseDir: string; sessionId?: string; objectId: string; stonesBranch?: string },
  mode: "read" | "write",
  __internal?: symbol,
): Promise<StoneObjectRef> {
  const { baseDir, sessionId, objectId, stonesBranch } = ref;
  const mainRef: StoneObjectRef = { baseDir, objectId };

  // feat 分支绑定优先（reflectable 沉淀直接编辑路径）：放在 sessionId 路由**最前面**。
  // 绑定缺省（绝大多数 thread）→ 整段跳过，下方 session 解析逐字节不变（回归不变量）。
  // 绑定存在 → super(foo) 读写自然落 feat worktree（无视 sessionId 是 super 还是 business）。
  if (stonesBranch) {
    const ready = await ensureFeatBranchWorktreeReady(baseDir, stonesBranch);
    if (ready) return { baseDir, objectId, _stonesBranch: stonesBranch };
    // 建失败（理论不到这——开分支入口已 eager 建）：兜底 main，warn 已发。
    return mainRef;
  }

  if (!sessionUsesWorktree(sessionId)) {
    // sessionUsesWorktree 排除 super + 无 sessionId → 解析到裸 main canonical。
    // mode="write" 在此处即业务/super/控制面写 main——只放行经 symbol 旁路的入口。
    if (mode === "write" && __internal !== MERGE_FAST_FORWARD_INTERNAL) {
      throw new SuperSessionRequiredError(
        `direct main write forbidden (sessionId=${sessionId ?? "<none>"}, objectId=${objectId}); ` +
          `use talk(target="super") + create_pr_for_versioned / sediment_unversioned / ` +
          `create_pr_for_class_edits via super flow instead.`,
      );
    }
    return mainRef;
  }

  const wtPath = sessionWorktreePath(baseDir, sessionId!);
  // `flows/<sid>` 与运行时数据共存——必须判 `.git`（真 worktree 信号），不能只判
  // 目录存在（可能只是 createFlowSession 先 mkdir 的空目录 / 纯运行时目录）。
  let ready = await isSessionWorktree(wtPath);
  if (!ready) {
    if (mode === "read") return mainRef; // 未建 worktree 且只读 → 透传 main
    ready = await ensureSessionWorktree(baseDir, sessionId!); // 写 → 建 worktree
    if (!ready) return mainRef; // 建失败兜底（business session 入口已 eager 建，正常不到这）
  }
  return { baseDir, objectId, _stonesBranch: sessionStoneBranch(sessionId!) };
}
