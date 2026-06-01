import { Elysia } from "elysia";
import type { createUiService } from "./service";

export function listFlowsApi(service: ReturnType<typeof createUiService>) {
  return new Elysia({ name: "ooc.ui.api.list-flows" }).get("/flows", () => service.listFlows());
}

