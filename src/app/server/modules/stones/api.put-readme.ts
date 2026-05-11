import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { objectIdParams, textBody } from "./model";

export function putReadmeApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.put-readme" }).put(
    "/stones/:objectId/readme",
    ({ params, body }) => service.putReadme({ ...params, ...body }),
    { params: objectIdParams, body: textBody }
  );
}
