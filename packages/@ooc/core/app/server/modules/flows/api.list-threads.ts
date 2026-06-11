import { Elysia } from "elysia";
import type { createFlowsService } from "./service";
import { sessionIdParams } from "./model";

/**
 * GET /api/flows/:sessionId/threads
 *
 * 列出 session 下所有 (objectId, threadId)；前端用作 thread 切换器数据源。
 *
 * collaborable § cross-object talk。
 */
export function listThreadsApi(service: ReturnType<typeof createFlowsService>) {
  return new Elysia({ name: "ooc.flows.api.list-threads" }).get(
    "/flows/:sessionId/threads",
    ({ params }) => service.listThreads(params),
    { params: sessionIdParams },
  );
}
