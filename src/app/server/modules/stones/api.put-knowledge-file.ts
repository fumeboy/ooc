import { Elysia } from "elysia";
import { objectIdParams, knowledgeFileBody } from "./model";
import type { createStonesService } from "./service";

export function putKnowledgeFileApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.put-knowledge-file" }).put(
    "/stones/:objectId/knowledge/files",
    ({ params, body }) => service.putKnowledgeFile({ objectId: params.objectId, path: body.path, content: body.content }),
    { params: objectIdParams, body: knowledgeFileBody }
  );
}

