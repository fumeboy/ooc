import { Elysia } from "elysia";
import type { createFlowsService } from "./service";

export function createSessionApi(service: ReturnType<typeof createFlowsService>) {
  return new Elysia({ name: "ooc.flows.api.create-session" }).all("/flows", async ({ request, set }) => {
    if (request.method === "GET") {
      return service.listFlows();
    }
    if (request.method === "POST") {
      const body = await request.json().catch(() => undefined);
      if (!body || typeof body !== "object" || typeof (body as { sessionId?: unknown }).sessionId !== "string") {
        set.status = 422;
        return { error: { code: "VALIDATION", message: "sessionId is required", details: null } };
      }
      const input = body as { sessionId: string; title?: unknown };
      return service.createSession({
        sessionId: input.sessionId,
        title: typeof input.title === "string" ? input.title : undefined,
      });
    }
    set.status = 405;
    return { error: { code: "METHOD_NOT_ALLOWED", message: `${request.method} /api/flows is not supported`, details: null } };
  });
}
