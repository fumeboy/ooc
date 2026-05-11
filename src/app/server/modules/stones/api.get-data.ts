import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { objectIdParams } from "./model";

export function getDataApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.get-data" }).get(
    "/stones/:objectId/data",
    ({ params }) => service.getData(params),
    { params: objectIdParams }
  );
}
