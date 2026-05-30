import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { objectIdParams } from "./model";

export function getReadableApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.get-readable" }).get(
    "/stones/:objectId/readable",
    ({ params }) => service.getReadable(params),
    { params: objectIdParams }
  );
}
