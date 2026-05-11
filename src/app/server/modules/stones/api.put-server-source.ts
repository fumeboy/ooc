import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { codeBody, objectIdParams } from "./model";

export function putServerSourceApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.put-server-source" }).put(
    "/stones/:objectId/server-source",
    ({ params, body }) => service.putServerSource({ ...params, ...body }),
    { params: objectIdParams, body: codeBody }
  );
}
