import { Elysia, t } from "elysia";
import type { createStonesService } from "./service";

export function listStonesApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.list-stones" }).get(
    "/stones",
    () => service.listStones(),
    {
      response: t.Object({
        items: t.Array(
          t.Object({
            objectId: t.String(),
            dir: t.String(),
          })
        ),
      }),
    }
  );
}
