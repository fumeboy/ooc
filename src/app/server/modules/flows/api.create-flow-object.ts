import { Elysia } from "elysia";
import type { createFlowsService } from "./service";
import { createFlowObjectBody, sessionIdParams } from "./model";

export function createFlowObjectApi(service: ReturnType<typeof createFlowsService>) {
  return new Elysia({ name: "ooc.flows.api.create-flow-object" }).post(
    "/flows/:sessionId/objects/",
    ({ params, body }) => service.createFlowObject({ ...params, ...body }),
    { params: sessionIdParams, body: createFlowObjectBody }
  );
}
