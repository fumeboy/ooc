import { Elysia, t } from "elysia";
import type { RuntimeService } from "./service";

/**
 * Governance：回滚某 Object 的 stone 到先前 commit（去固化 metaprog method 后，2026-06-09）。
 *
 * POST /api/runtime/stones/:objectId/rollback
 * Body: { targetCommit: string }
 *
 * 控制面 = supervisor 治理身份；service 固定以 SUPERVISOR_OBJECT_ID 调底层
 * persistable rollback（保留不动）。失败由 service 转 AppServerError（INVALID_INPUT →
 * 400 / FORBIDDEN → 409 / git 失败 → 500）。
 */
const rollbackParams = t.Object({
  objectId: t.String(),
});

const rollbackBody = t.Object({
  targetCommit: t.String(),
});

export function rollbackStoneApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.rollback-stone" }).post(
    "/runtime/stones/:objectId/rollback",
    ({ params, body }) =>
      service.rollbackStone({
        objectId: params.objectId,
        targetCommit: body.targetCommit,
      }),
    { params: rollbackParams, body: rollbackBody },
  );
}
