import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { objectIdParams, textBody } from "./model";

export function putSelfApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.put-self" }).put(
    "/stones/:objectId/self",
    ({ params, body }) => service.putSelf({ ...params, ...body }),
    { params: objectIdParams, body: textBody }
  );
}
