import { resolveStoneIdentityDir } from "@ooc/core/persistable/index.js";
import type { FlowObjectRef } from "@ooc/core/persistable/index.js";

/**
 * shell 模式派生额外环境变量。当前只透出 `OOC_SELF_DIR`，让命令可稳定定位 stone 目录。
 *
 * 依赖边界：只需要 session 工作区引用（FlowObjectRef = baseDir/sessionId/objectId），
 * **不依赖调用现场 thread**——object method 的执行环境是 session（object 的工作区），
 * 不与某个 thread 绑定。
 *
 * 路径经 `resolveStoneIdentityDir(ref, "write")` 解析（worktree 统一模型）：
 * - business session → 该 session 的 worktree object 目录（方案 A：`flows/<sid>/objects/<id>/`，
 *   main HEAD 的完整副本）。program shell 在这里裸读裸写都看得到完整 identity，改动落 worktree
 *   不污染 main，经 super flow create_pr_and_invite_reviewers 合入才永久——与 write_file/edit 收敛到同一目录。
 * - super / 控制面 → main canonical（`stones/main/objects/<id>/`）。
 *
 * mode="write"：shell 可写 identity，故 lazy 建 worktree。**不要**手拼 `stones/<id>`。
 */
export async function buildProgramShellEnv(
  session: FlowObjectRef | undefined,
): Promise<Record<string, string>> {
  if (!session) {
    return {};
  }

  const selfDir = await resolveStoneIdentityDir(
    { baseDir: session.baseDir, sessionId: session.sessionId, objectId: session.objectId },
    "write",
  );
  return {
    OOC_SELF_DIR: selfDir,
  };
}
