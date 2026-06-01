import { Elysia } from "elysia";
import { objectIdParams, knowledgeFileBody } from "./model";
import type { createStonesService } from "./service";

/**
 * POST /api/stones/:objectId/knowledge/files
 *
 * 根因 #3 (2026-05-24)：knowledge 实际写入位置是 pool 层（`pools/objects/<id>/knowledge/`），
 * 不在 stones/ 下；旧 `/api/stones/.../knowledge/...` 路径保留兼容，标记 deprecation。
 * 新代码请改用对称的 `POST /api/pools/:objectId/knowledge/files`（见 ../pools/）。
 */
export function createKnowledgeFileApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.create-knowledge-file" }).post(
    "/stones/:objectId/knowledge/files",
    async ({ params, body, set }) => {
      set.headers["x-deprecated"] = "true";
      set.headers["x-deprecation-info"] =
        "Use /api/pools/:objectId/knowledge/files (knowledge lives in pool layer since 2026-05-23)";
      if (process.env.NODE_ENV !== "test") {
        console.warn(
          `[deprecated] POST /api/stones/${params.objectId}/knowledge/files — use /api/pools/${params.objectId}/knowledge/files`,
        );
      }
      return service.createKnowledgeFile({ objectId: params.objectId, path: body.path, content: body.content });
    },
    { params: objectIdParams, body: knowledgeFileBody }
  );
}
