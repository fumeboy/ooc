import { Elysia } from "elysia";
import type { createFlowsService } from "./service";
import { sessionIdParams } from "./model";

export function pauseSessionApi(service: ReturnType<typeof createFlowsService>) {
  return new Elysia({ name: "ooc.flows.api.pause-session" }).post(
    "/flows/:sessionId/pause",
    ({ params }) => service.pauseSession(params),
    { params: sessionIdParams }
  );
}
