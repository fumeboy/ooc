import { Elysia, t } from "elysia";
import type { createStonesService } from "./service";

export function createStoneApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.create-stone" }).post(
    "/stones",
    ({ body }) => service.createStone(body),
    { body: t.Object({ objectId: t.String() }) }
  );
}
