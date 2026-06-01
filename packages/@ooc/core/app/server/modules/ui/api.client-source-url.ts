/**
 * GET /api/objects/:scope/:objectId/client-source-url
 *
 * 根因 #3 (2026-05-24)：frontend 不再自拼 client/index.tsx 路径。
 *
 * 旧实现 `web/src/domains/clients/ObjectClientRenderer.tsx` 硬编码：
 *   `${WORLD_ROOT}/stones/${id}/client/index.tsx`
 * 2026-05-21 stones 重组后路径变成 `stones/main/objects/<id>/client/...`，硬编码漂移。
 *
 * 新契约：frontend 调本 endpoint，backend 用 `stoneDir()` / `objectDir()` 权威给出
 * 绝对路径 + vite `/@fs` URL；frontend 直接 dynamic import。
 *
 * 形态：
 *   GET /api/objects/stone/:objectId/client-source-url
 *     → { absPath, fsUrl }              （stone：单页 client/index.tsx）
 *   GET /api/objects/flow/:objectId/client-source-url?sessionId=<sid>&page=<page>
 *     → { absPath, fsUrl }              （flow：多页 client/pages/<page>.tsx）
 *
 * 文件不存在时返回 404（NOT_FOUND，与统一错误模型一致），让 frontend fallback
 * 到 StoneFallback / NotProducedYet。
 */
import { Elysia, t } from "elysia";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { objectDir, stoneDir } from "@ooc/core/persistable";
import type { ServerConfig } from "../../bootstrap/config";
import { AppServerError } from "../../bootstrap/errors";

const paramsSchema = t.Object({
  scope: t.Union([t.Literal("stone"), t.Literal("flow")]),
  objectId: t.String(),
});

const querySchema = t.Object({
  sessionId: t.Optional(t.String()),
  page: t.Optional(t.String()),
});

function assertSafeIdentifier(value: string, field: string): void {
  if (!value || value.includes("/") || value.includes("\\") || value.includes("..") || value.includes("\0")) {
    throw new AppServerError("INVALID_INPUT", `unsafe ${field} '${value}'`, { [field]: value });
  }
}

export function clientSourceUrlApi(config: Pick<ServerConfig, "baseDir">) {
  return new Elysia({ name: "ooc.ui.api.client-source-url" }).get(
    "/objects/:scope/:objectId/client-source-url",
    async ({ params, query }) => {
      const { scope, objectId } = params;
      assertSafeIdentifier(objectId, "objectId");

      let absPath: string;
      if (scope === "stone") {
        absPath = join(stoneDir({ baseDir: config.baseDir, objectId }), "client", "index.tsx");
      } else {
        // flow scope 需要 sessionId + page
        const sessionId = query.sessionId;
        const page = query.page;
        if (!sessionId || !page) {
          throw new AppServerError(
            "INVALID_INPUT",
            "flow scope requires sessionId and page query params",
            { scope, sessionId, page },
          );
        }
        assertSafeIdentifier(sessionId, "sessionId");
        assertSafeIdentifier(page, "page");
        absPath = join(
          objectDir({ baseDir: config.baseDir, sessionId, objectId }),
          "client",
          "pages",
          `${page}.tsx`,
        );
      }

      try {
        const st = await stat(absPath);
        if (!st.isFile()) {
          throw new AppServerError("NOT_FOUND", `client source is not a regular file: ${absPath}`, { absPath });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new AppServerError("NOT_FOUND", `client source not found for ${scope} '${objectId}'`, {
            absPath,
            scope,
            objectId,
          });
        }
        throw error;
      }

      return {
        absPath,
        fsUrl: `/@fs${absPath}`,
      };
    },
    { params: paramsSchema, query: querySchema },
  );
}
