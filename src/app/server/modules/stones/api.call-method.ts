import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { callMethodBody, objectIdParams } from "./model";

export function callMethodApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.call-method" }).post(
    "/stones/:objectId/call_method",
    ({ params, body }) => service.callMethod({ ...params, ...body }),
    { params: objectIdParams, body: callMethodBody }
  );
}
