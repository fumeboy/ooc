/**
 * health endpoint —— `GET /health` 返回服务状态（最小）。
 */
import { Elysia } from "elysia";

export const healthModule = new Elysia({ prefix: "/health" }).get("/", () => ({
  ok: true,
  at: Date.now(),
}));
