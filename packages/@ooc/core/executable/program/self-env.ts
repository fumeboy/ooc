import { resolveStoneIdentityDir } from "../../persistable/index.js";
import type { ThreadContext } from "../../thinkable/context.js";

/**
 * shell 模式下为当前线程派生额外环境变量。
 * 当前只透出 `OOC_SELF_DIR`，让命令可稳定定位 stone 目录。
 *
 * 路径经 `resolveStoneIdentityDir(ref, "write")` 解析（worktree 统一模型）：
 * - business session → 该 session 的 worktree object 目录（方案 A：`flows/<sid>/objects/<id>/`，
 *   main HEAD 的完整副本）。program shell 在这里裸读裸写都看得到完整 identity，改动落 worktree
 *   不污染 main，经 super flow evolve_self 合入才永久——与 write_file/edit 收敛到同一目录。
 * - super / 控制面 → main canonical（`stones/main/objects/<id>/`）。
 *
 * mode="write"：shell 可写 identity，故 lazy 建 worktree。**不要**手拼 `stones/<id>`。
 */
export async function buildProgramShellEnv(thread: ThreadContext): Promise<Record<string, string>> {
  const persistence = thread.persistence;
  if (!persistence) {
    return {};
  }

  const selfDir = await resolveStoneIdentityDir(
    { baseDir: persistence.baseDir, sessionId: persistence.sessionId, objectId: persistence.objectId },
    "write",
  );
  return {
    OOC_SELF_DIR: selfDir,
  };
}
