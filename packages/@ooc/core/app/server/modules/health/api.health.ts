import { Elysia } from "elysia";

export const healthApi = new Elysia({ name: "ooc.health.api.health" }).get("/health", () => ({
  ok: true,
  service: "ooc-app-server",
  time: Date.now(),
}));
