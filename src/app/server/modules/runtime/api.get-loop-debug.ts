import { Elysia } from "elysia";
import type { RuntimeService } from "./service";
import { loopDebugParams } from "./model";

export function getLoopDebugApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.get-loop-debug" }).get(
    "/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug/loops/:loopIndex",
    ({ params, query }) => service.getLoopDebug({
      baseDir: typeof query.baseDir === 'string' ? query.baseDir : process.cwd(),
      sessionId: params.sessionId,
      objectId: params.objectId,
      threadId: params.threadId,
    }, params.loopIndex),
    { params: loopDebugParams }
  );
}
