import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { objectIdParams } from "./model";

export function getSelfApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.get-self" }).get(
    "/stones/:objectId/self",
    ({ params }) => service.getSelf(params),
    { params: objectIdParams }
  );
}
