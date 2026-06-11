import { Elysia } from "elysia";
import type { createFlowsService } from "./service";
import { continueThreadBody, sessionIdParams } from "./model";

/**
 * POST /api/flows/:sessionId/continue
 *
 * collaborable cross-object talk：
 * 把 user 这一轮输入投递到当前 session 中由 user.root 上 talk_window 指向的 callee；
 * 等价于 user 这个 flow object 在它的 root thread 上调用 talk_window.say。
 *
 * Body：
 * - text：消息文本
 * - targetWindowId：可选，user.root 上的某个 talk_window id；缺省取首个非 creator talk_window
 *
 * Side effects：
 * - user.root.outbox + callee.inbox 双写
 * - callee 状态翻 running，入队一个 run-thread job
 */
export function continueThreadApi(service: ReturnType<typeof createFlowsService>) {
  return new Elysia({ name: "ooc.flows.api.continue-thread" }).post(
    "/flows/:sessionId/continue",
    ({ params, body }) => service.continueThread({ ...params, ...body }),
    { params: sessionIdParams, body: continueThreadBody },
  );
}
