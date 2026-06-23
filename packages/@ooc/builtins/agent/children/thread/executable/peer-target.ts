/**
 * peer target 存在性校验 —— peer 会话（talk target=别的对象）的前置守卫。
 *
 * 构造器纯化后不再做此校验（construct 是纯工厂、不识 peer target stone）；归 `agent.talk` peer 分支：
 * 开 peer 会话窗前确认 target 对象在**当前 session 上下文**真实存在（session worktree 优先、回落 main
 * canonical），避免开一条指向不存在对象的死会话窗。super-alias / 无 persistence 视为通过。
 */

import { stat } from "node:fs/promises";
import { stoneDir, resolveStoneIdentityRef } from "@ooc/core/persistable/index.js";
import { SUPER_ALIAS_TARGET } from "@ooc/core/_shared/types/constants.js";
import type { ThreadPersistenceRef } from "@ooc/core/persistable/common.js";

/** target 对象是否在当前 session 上下文存在（session-aware：worktree 优先、回落 main）。 */
export async function peerTargetExists(
  persistence: ThreadPersistenceRef | undefined,
  target: string,
): Promise<boolean> {
  if (target === SUPER_ALIAS_TARGET) return true; // super 自指别名：派到自身 super 分身，无需 stone。
  if (!persistence?.baseDir) return true; // 无盘上定位（纯内存模式）：不校验。
  const stoneRef = await resolveStoneIdentityRef(
    { baseDir: persistence.baseDir, sessionId: persistence.sessionId, objectId: target },
    "read",
  );
  try {
    return (await stat(stoneDir(stoneRef))).isDirectory();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
