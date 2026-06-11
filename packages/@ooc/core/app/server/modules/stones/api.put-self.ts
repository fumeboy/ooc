import { Elysia } from "elysia";
import type { createStonesService } from "./service";
import { objectIdParams, textBody } from "./model";

/**
 * PUT /api/stones/:objectId/self
 *
 * 覆盖性写入护栏。已存在的 self.md 要覆盖必须带 header
 * `X-Overwrite-Confirm: true`,否则 service 层抛 OVERWRITE_REQUIRES_CONFIRM(409)。
 * 首次写入(self.md 不存在)不需要 confirm。
 */
export function putSelfApi(service: ReturnType<typeof createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.put-self" }).put(
    "/stones/:objectId/self",
    ({ params, body, request }) =>
      service.putSelf({
        ...params,
        ...body,
        confirmOverwrite: request.headers.get("x-overwrite-confirm") === "true",
      }),
    { params: objectIdParams, body: textBody }
  );
}
