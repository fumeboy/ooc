import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { objectIdParams } from "./model";

export function getExecutableSourceApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.get-executable-source" }).get(
    "/stones/:objectId/executable-source",
    ({ params }) => service.getExecutableSource(params),
    { params: objectIdParams }
  );
}
