import { Elysia } from "elysia";
import { objectIdParams, knowledgeDirectoryBody } from "./model";
import type { createStonesService } from "./service";

export function createKnowledgeDirectoryApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.create-knowledge-directory" }).post(
    "/stones/:objectId/knowledge/directories",
    ({ params, body }) => service.createKnowledgeDirectory({ objectId: params.objectId, path: body.path }),
    { params: objectIdParams, body: knowledgeDirectoryBody }
  );
}

