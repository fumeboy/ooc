/**
 * pools 模块（2026-05-24，根因 #3）。
 *
 * 把 knowledge HTTP 路径从 `/api/stones/.../knowledge/...` 迁移到对称的
 * `/api/pools/.../knowledge/...`——backend 实际写入位置是 pool 层
 * （`pools/objects/<id>/knowledge/`），旧路径语义错位。
 *
 * 旧路径在 `../stones/api.*-knowledge-*.ts` 保留并加 `X-Deprecated` header；
 * 计划在下个 major 移除。
 *
 * 反熵：不引入新 service 抽象——复用 stones service 的 createKnowledgeFile /
 * putKnowledgeFile / createKnowledgeDirectory（这些函数本来就写到 pool 路径）。
 */
import { Elysia } from "elysia";
import type { ServerConfig } from "../../bootstrap/config";
import { createStonesService } from "../stones/service";
import { knowledgeDirectoryBody, knowledgeFileBody, objectIdParams } from "../stones/model";

export function poolsModule(config: Pick<ServerConfig, "baseDir" | "stonesBranch">) {
  const service = createStonesService({ baseDir: config.baseDir, stonesBranch: config.stonesBranch });

  return new Elysia({ prefix: "/api", name: "ooc.pools" })
    .post(
      "/pools/:objectId/knowledge/directories",
      ({ params, body }) => service.createKnowledgeDirectory({ objectId: params.objectId, path: body.path }),
      { params: objectIdParams, body: knowledgeDirectoryBody },
    )
    .post(
      "/pools/:objectId/knowledge/files",
      ({ params, body }) =>
        service.createKnowledgeFile({ objectId: params.objectId, path: body.path, content: body.content }),
      { params: objectIdParams, body: knowledgeFileBody },
    )
    .put(
      "/pools/:objectId/knowledge/files",
      ({ params, body, request }) =>
        service.putKnowledgeFile({
          objectId: params.objectId,
          path: body.path,
          content: body.content,
          confirmOverwrite: request.headers.get("x-overwrite-confirm") === "true",
        }),
      { params: objectIdParams, body: knowledgeFileBody },
    );
}
