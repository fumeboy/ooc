import { Elysia } from "elysia";
import { objectIdParams, knowledgeFileBody } from "./model";
import type { createStonesService } from "./service";

/**
 * PUT /api/stones/:objectId/knowledge/files
 *
 * Issue #6 Bad #4: 覆盖性写入护栏。已存在的 knowledge file 要覆盖必须带 header
 * `X-Overwrite-Confirm: true`,否则抛 OVERWRITE_REQUIRES_CONFIRM(409)。
 * 新建文件请用 POST(create-knowledge-file)路径。
 */
export function putKnowledgeFileApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.put-knowledge-file" }).put(
    "/stones/:objectId/knowledge/files",
    ({ params, body, request }) =>
      service.putKnowledgeFile({
        objectId: params.objectId,
        path: body.path,
        content: body.content,
        confirmOverwrite: request.headers.get("x-overwrite-confirm") === "true",
      }),
    { params: objectIdParams, body: knowledgeFileBody }
  );
}
