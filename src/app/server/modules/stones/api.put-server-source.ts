import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { codeBody, objectIdParams } from "./model";

/**
 * PUT /api/stones/:objectId/server-source
 *
 * Issue #6 Bad #4: 覆盖性写入护栏。已存在的 server/index.ts 要覆盖必须带 header
 * `X-Overwrite-Confirm: true`,否则抛 OVERWRITE_REQUIRES_CONFIRM(409)。
 */
export function putServerSourceApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.put-server-source" }).put(
    "/stones/:objectId/server-source",
    ({ params, body, request }) =>
      service.putServerSource({
        ...params,
        ...body,
        confirmOverwrite: request.headers.get("x-overwrite-confirm") === "true",
      }),
    { params: objectIdParams, body: codeBody }
  );
}
