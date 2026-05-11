import { Elysia } from "elysia";
import type { createFlowsService } from "./service";
import { flowObjectParams } from "./model";

export function getFlowObjectApi(service: ReturnType<typeof createFlowsService>) {
  return new Elysia({ name: "ooc.flows.api.get-flow-object" }).get(
    "/flows/:sessionId/objects/:objectId",
    ({ params }) => service.getFlowObject(params),
    { params: flowObjectParams }
  );
}
