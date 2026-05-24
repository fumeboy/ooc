import { Elysia } from "elysia";
import type { RuntimeService } from "./service";
import { loopDebugParams } from "./model";

/**
 * Round 8 B5 fix: 同 api.get-latest-debug.ts，不再 fallback 到 process.cwd()。
 * 同时把 label 从 `loop_${loopIndex}.input.json`（如 loop_1）改为与磁盘实际文件名
 * （zero-pad 4 位：loop_0001）一致，让错误信息可直接指向文件。
 *
 * R8-4 fix (security, 2026-05-25): 同步删除 `?baseDir=` query override，详见
 * api.get-latest-debug.ts 注释。
 */
export function getLoopDebugApi(service: RuntimeService, baseDir: string) {
  return new Elysia({ name: "ooc.runtime.api.get-loop-debug" }).get(
    "/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug/loops/:loopIndex",
    ({ params }) => service.getLoopDebug({
      baseDir,
      sessionId: params.sessionId,
      objectId: params.objectId,
      threadId: params.threadId,
    }, params.loopIndex),
    { params: loopDebugParams }
  );
}
