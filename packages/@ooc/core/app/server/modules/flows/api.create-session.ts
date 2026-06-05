import { Elysia } from "elysia";
import type { createFlowsService } from "./service";

/**
 * `/api/flows` + `/api/sessions` 协议层 alias 注册。
 *
 * Issue #6 Bad #3: URL 命名分裂 — `GET /api/flows`(列表) vs `POST /api/sessions`
 * (创建,在 api.seed-session.ts) 是同一资源(session/flow)在两个名词下,第三方
 * 读路由表会困惑。
 *
 * 本轮选择**保守迁移方案**:
 * - 新增 `GET /api/sessions` 作为列表接口规范名(复用同一 service.listFlows())
 * - `GET /api/flows` 保留向后兼容,**但回写 `X-Deprecated` header**:
 *   `X-Deprecated: GET /api/flows is deprecated, use GET /api/sessions`
 * - `POST /api/flows`(创建)同样回写 deprecation header,引导外部用 `POST /api/sessions`
 *
 * 不在本轮:
 * - 不删除 `/api/flows` 任何端点(前端 web/src/transport/endpoints.ts 仍在用,
 *   下一轮 AgentOfVisible 迁移)
 * - per-session 路径(`/api/flows/:sid/threads` 等)
 *   不在本次 alias 范围,迁移成本高;下一个大版本统一收口
 */
export function createSessionApi(service: ReturnType<typeof createFlowsService>) {
  const FLOWS_DEPRECATION = "GET/POST /api/flows is deprecated; use /api/sessions instead";

  return new Elysia({ name: "ooc.flows.api.create-session" })
    // legacy: /api/flows — 标 deprecation
    .all("/flows", async ({ request, set }) => {
      set.headers["x-deprecated"] = FLOWS_DEPRECATION;
      if (request.method === "GET") {
        return service.listFlows();
      }
      if (request.method === "POST") {
        // intentional: silent-swallow ban 例外——JSON 解析失败时回退到 undefined，
        // 下方显式发 422 VALIDATION 错误响应（不是吞噬，是显式错误模型）。
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
    })
    // canonical: GET /api/sessions — 复用 listFlows
    // (POST /api/sessions 已在 api.seed-session.ts 中作 seedSession,语义更丰富,不在此处重复注册)
    .get("/sessions", () => service.listFlows());
}
