import { Elysia } from "elysia";
import type { createFlowsService } from "./service";
import { injectThreadBody, threadParams } from "./model";

/**
 * POST /api/flows/:sessionId/objects/:objectId/threads/:threadId/inject
 *
 * 向指定线程追加一条 user inject 事件，并自动入队 run-thread job，
 * 让 worker 在下一轮 think 中处理。用于"thread 跑完后用户继续提问"的多轮对话。
 *
 * 状态约束：
 * - thread 必须存在
 * - thread 状态 done/waiting/running 都允许追加；追加后状态翻回 running
 */
export function injectThreadApi(service: ReturnType<typeof createFlowsService>) {
  return new Elysia({ name: "ooc.flows.api.inject-thread" }).post(
    "/flows/:sessionId/objects/:objectId/threads/:threadId/inject",
    ({ params, body }) => service.injectThread({ ...params, ...body }),
    { params: threadParams, body: injectThreadBody }
  );
}
