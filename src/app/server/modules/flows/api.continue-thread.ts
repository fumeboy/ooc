import { Elysia } from "elysia";
import type { createFlowsService } from "./service";
import { continueThreadBody, threadParams } from "./model";

/**
 * POST /api/flows/:sessionId/objects/:objectId/threads/:threadId/continue
 *
 * 向指定线程追加一条用户消息，并自动入队 run-thread job，
 * 让 worker 在下一轮 think 中继续处理。用于"thread 跑完后用户继续提问"的多轮对话。
 *
 * 状态约束：
 * - thread 必须存在
 * - thread 状态 done/waiting/running/failed 都允许继续；继续后状态翻回 running
 */
export function continueThreadApi(service: ReturnType<typeof createFlowsService>) {
  return new Elysia({ name: "ooc.flows.api.continue-thread" }).post(
    "/flows/:sessionId/objects/:objectId/threads/:threadId/continue",
    ({ params, body }) => service.continueThread({ ...params, ...body }),
    { params: threadParams, body: continueThreadBody }
  );
}
