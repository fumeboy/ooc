import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { objectIdParams, textBody } from "./model";

/**
 * PUT /api/stones/:objectId/readme
 *
 * 覆盖性写入护栏。已存在的 readme.md 要覆盖必须带 header
 * `X-Overwrite-Confirm: true`,否则抛 OVERWRITE_REQUIRES_CONFIRM(409)。
 */
export function putReadmeApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.put-readme" }).put(
    "/stones/:objectId/readme",
    ({ params, body, request }) =>
      service.putReadme({
        ...params,
        ...body,
        confirmOverwrite: request.headers.get("x-overwrite-confirm") === "true",
      }),
    { params: objectIdParams, body: textBody }
  );
}
