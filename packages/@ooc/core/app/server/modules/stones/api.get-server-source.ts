import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { objectIdParams } from "./model";

export function getServerSourceApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.get-server-source" }).get(
    "/stones/:objectId/server-source",
    ({ params }) => service.getServerSource(params),
    { params: objectIdParams }
  );
}
