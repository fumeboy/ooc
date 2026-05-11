import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { objectIdParams, patchDataBody } from "./model";

export function patchDataApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.patch-data" }).patch(
    "/stones/:objectId/data",
    ({ params, body }) => service.patchData({ ...params, ...body }),
    { params: objectIdParams, body: patchDataBody }
  );
}
