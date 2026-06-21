import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { objectIdParams, putFileBody } from "./model";

/**
 * PUT /api/stones/:objectId/file
 *
 * file-agnostic 版本化写入。body: { path, content }，path 须经白名单校验（assertEditableStonePath）。
 * 覆盖护栏：已存在的文件要覆盖须带 header `X-Overwrite-Confirm: true`，
 * 否则 service 层抛 OVERWRITE_REQUIRES_CONFIRM(409)。
 *
 * 允许写入的 path：
 *   - self.md / readable.md / executable/index.ts / visible/index.tsx（精确）
 *   - knowledge/<name>.md（单级，限 .md）
 */
export function putFileApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.put-file" }).put(
    "/stones/:objectId/file",
    ({ params, body, request }) =>
      service.putFile({
        objectId: params.objectId,
        path: body.path,
        content: body.content,
        confirmOverwrite: request.headers.get("x-overwrite-confirm") === "true",
      }),
    { params: objectIdParams, body: putFileBody }
  );
}
