import { Elysia } from "elysia";
import { objectIdParams, knowledgeDirectoryBody } from "./model";
import type { createStonesService } from "./service";

/**
 * POST /api/stones/:objectId/knowledge/directories
 *
 * deprecated；改用 POST /api/pools/:objectId/knowledge/directories。
 */
export function createKnowledgeDirectoryApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.create-knowledge-directory" }).post(
    "/stones/:objectId/knowledge/directories",
    async ({ params, body, set }) => {
      set.headers["x-deprecated"] = "true";
      set.headers["x-deprecation-info"] =
        "Use /api/pools/:objectId/knowledge/directories (knowledge lives in pool layer since 2026-05-23)";
      if (process.env.NODE_ENV !== "test") {
        console.warn(
          `[deprecated] POST /api/stones/${params.objectId}/knowledge/directories — use /api/pools/${params.objectId}/knowledge/directories`,
        );
      }
      return service.createKnowledgeDirectory({ objectId: params.objectId, path: body.path });
    },
    { params: objectIdParams, body: knowledgeDirectoryBody }
  );
}
