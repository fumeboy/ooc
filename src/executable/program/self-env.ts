import { deriveStoneFromThread } from "../../persistable/index.js";
import type { ThreadContext } from "../../thinkable/context.js";

/**
 * shell 模式下为当前线程派生额外环境变量。
 * 当前只透出 `OOC_SELF_DIR`，让命令可稳定定位 stone 目录。
 */
export function buildProgramShellEnv(thread: ThreadContext): Record<string, string> {
  if (!thread.persistence) {
    return {};
  }

  const stoneRef = deriveStoneFromThread(thread.persistence);
  return {
    OOC_SELF_DIR: `${stoneRef.baseDir}/stones/${stoneRef.objectId}`
  };
}
