import { Elysia } from "elysia";
import type { createFlowsService } from "./service";
import { callMethodBody, flowObjectParams } from "./model";

export function callMethodApi(service: ReturnType<typeof createFlowsService>) {
  return new Elysia({ name: "ooc.flows.api.call-method" }).post(
    "/flows/:sessionId/:objectId/call_method",
    ({ params, body }) => service.callMethod({ ...params, ...body }),
    { params: flowObjectParams, body: callMethodBody }
  );
}
