import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { objectIdParams } from "./model";

export function getReadmeApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.get-readme" }).get(
    "/stones/:objectId/readme",
    ({ params }) => service.getReadme(params),
    { params: objectIdParams }
  );
}
