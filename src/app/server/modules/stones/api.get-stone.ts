import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { objectIdParams } from "./model";

export function getStoneApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.get-stone" }).get(
    "/stones/:objectId",
    ({ params }) => service.getStone(params),
    { params: objectIdParams }
  );
}
