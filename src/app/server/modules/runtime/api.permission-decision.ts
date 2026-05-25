import { Elysia, t } from "elysia";
import type { RuntimeService } from "./service";
import { threadDebugParams } from "./model";

/**
 * Q0c: HITL approve / reject 入口 (AgentOfExecutable + AgentOfVisible)。
 *
 * Design: docs/2026-05-25-permission-model-design.md §原则F + Q0c
 * Meta:   meta/object.doc.ts:executable.children.permission.patches.approve_reject_path
 *
 * POST /api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/permission
 *
 * Body:
 *   { eventId?: string, action: "approve" | "reject", reason?: string }
 *
 * 行为:
 *   1. readThread → 必须存在 (404)
 *   2. 校验 status === "paused" (400 thread-not-paused)
 *   3. 找最近一条 kind=permission_ask 且无 decided 的 event (eventId 给定时精确匹配)
 *      - 无 → 400 no-pending-ask
 *      - eventId 拼错 / 找不到 → 404
 *      - eventId 对应的 event 已 decided → 400 already-decided
 *   4. 写 decided 字段 + 翻 status=running + writeThread
 *   5. notifyThreadActivated → jobManager.createRunThreadJob (与 talk-delivery / end auto-reply 同款路径)
 *
 * 路径与 design 文档 §6 描述的 `/api/threads/:threadId/permission` 略有出入: 实际改为
 *   `/api/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/permission`
 * 复用现有 threadDebugParams + 与 get-latest-debug endpoint 同 prefix, 避免引入"按
 * threadId 全局扫 session"的新机制 (扫成本高且不稳, threadId 可能跨 session 重复)。
 */
const permissionBody = t.Object({
  eventId: t.Optional(t.String()),
  action: t.Union([t.Literal("approve"), t.Literal("reject")]),
  reason: t.Optional(t.String()),
});

export function permissionDecisionApi(service: RuntimeService, baseDir: string) {
  return new Elysia({ name: "ooc.runtime.api.permission-decision" }).post(
    "/runtime/flows/:sessionId/objects/:objectId/threads/:threadId/permission",
    ({ params, body }) =>
      service.decidePermission({
        ref: {
          baseDir,
          sessionId: params.sessionId,
          objectId: params.objectId,
          threadId: params.threadId,
        },
        eventId: body.eventId,
        action: body.action,
        reason: body.reason,
      }),
    { params: threadDebugParams, body: permissionBody },
  );
}
