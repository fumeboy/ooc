import { Elysia } from "elysia";
import type { createFlowsService } from "./service";
import { sessionIdParams } from "./model";

export function resumeSessionApi(service: ReturnType<typeof createFlowsService>) {
  return new Elysia({ name: "ooc.flows.api.resume-session" }).post(
    "/flows/:sessionId/resume",
    ({ params }) => service.resumeSession(params),
    { params: sessionIdParams }
  );
}
