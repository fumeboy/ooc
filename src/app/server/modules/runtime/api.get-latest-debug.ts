import { Elysia } from "elysia";
import type { RuntimeService } from "./service";
import { threadDebugParams } from "./model";

export function getLatestDebugApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.get-latest-debug" }).get(
    "/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/debug",
    ({ params, query }) => service.getLatestDebug({
      baseDir: typeof query.baseDir === 'string' ? query.baseDir : process.cwd(),
      sessionId: params.sessionId,
      objectId: params.objectId,
      threadId: params.threadId,
    }),
    { params: threadDebugParams }
  );
}
