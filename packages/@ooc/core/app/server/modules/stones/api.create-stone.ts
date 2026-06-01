import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { createStoneBody } from "./model";

export function createStoneApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.create-stone" }).post(
    "/stones",
    ({ body }) => service.createStone(body),
    { body: createStoneBody }
  );
}
