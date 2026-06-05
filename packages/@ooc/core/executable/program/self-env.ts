import { deriveStoneFromThread, stoneDir } from "../../persistable/index.js";
import type { ThreadContext } from "../../thinkable/context.js";

/**
 * shell 模式下为当前线程派生额外环境变量。
 * 当前只透出 `OOC_SELF_DIR`，让命令可稳定定位 stone 目录。
 *
 * 路径用 `stoneDir(stoneRef)` 解析（与 context buildPathsItem 注入给 LLM 的
 * `object_stone_dir` 同源）。**不要**手拼 `stones/<id>`：P1 路径收口后 canonical 是
 * `stones/main/objects/<id>/`，手拼会指向不存在的孤儿路径，program shell 写入的
 * server/index.ts 落到那里既不被 runtime 加载也与 [ooc:paths] 给 LLM 的路径不一致。
 */
export function buildProgramShellEnv(thread: ThreadContext): Record<string, string> {
  if (!thread.persistence) {
    return {};
  }

  const stoneRef = deriveStoneFromThread(thread.persistence);
  return {
    OOC_SELF_DIR: stoneDir(stoneRef),
  };
}
