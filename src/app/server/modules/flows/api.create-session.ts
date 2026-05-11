import { Elysia } from "elysia";
import type { createFlowsService } from "./service";
import { createSessionBody } from "./model";

export function createSessionApi(service: ReturnType<typeof createFlowsService>) {
  return new Elysia({ name: "ooc.flows.api.create-session" }).post(
    "/flows/",
    ({ body }) => service.createSession(body),
    { body: createSessionBody }
  );
}
