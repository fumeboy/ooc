import { Elysia } from "elysia";
import type { createFlowsService } from "./service";
import { threadParams } from "./model";

export function getThreadApi(service: ReturnType<typeof createFlowsService>) {
  return new Elysia({ name: "ooc.flows.api.get-thread" }).get(
    "/flows/:sessionId/:objectId/threads/:threadId",
    ({ params }) => service.getThread(params),
    { params: threadParams }
  );
}
