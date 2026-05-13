import { Elysia } from "elysia";
import { objectIdParams, knowledgeFileBody } from "./model";
import type { createStonesService } from "./service";

export function createKnowledgeFileApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.create-knowledge-file" }).post(
    "/stones/:objectId/knowledge/files",
    ({ params, body }) => service.createKnowledgeFile({ objectId: params.objectId, path: body.path, content: body.content }),
    { params: objectIdParams, body: knowledgeFileBody }
  );
}

