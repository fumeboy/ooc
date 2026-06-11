import { Elysia } from "elysia";
import type { createFlowsService } from "./service";
import { seedSessionBody } from "./model";

/**
 * POST /api/sessions
 *
 * collaborable cross-object talk：一次性 seed 一个 web session：
 * - 建 session 与 user flow object
 * - user.root.contextWindows 上挂一个指向 targetObjectId 的 talk_window
 * - 调 talk-delivery 在 target 下创建 callee thread + 写双方消息
 * - enqueue run-thread job 让 worker 调度 callee
 *
 * 取代旧 "POST /api/flows + POST /api/flows/:sid/objects" 两步法（旧 API 仍保留，
 * 直接建 flow object 不经过 user，用于程序化测试）。
 */
export function seedSessionApi(service: ReturnType<typeof createFlowsService>) {
  return new Elysia({ name: "ooc.flows.api.seed-session" }).post(
    "/sessions",
    ({ body }) => service.seedSession(body),
    { body: seedSessionBody },
  );
}
