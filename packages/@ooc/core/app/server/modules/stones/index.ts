/**
 * stones module — server module for stone object CRUD + 通用 file-edit 原语 endpoint。
 *
 * **issue S1 (2026-06-29)**: 实现设计权威说应有的 `PUT /api/stones/:id/file?path=` 通用
 * file-edit 原语 (+ 对称 read endpoint),替代 ooc-6 时代 typed self/readable/executable
 * 端点。详见 `.ooc-world-meta/.../docs/issues/2026-06-29-s1-file-edit-read-primitive.md`。
 *
 * 当前 endpoint 列表 (本 issue S1):
 *   - GET    /api/stones/:id/file?path=<rel>       — 读 stone 文件 (三层防护)
 *   - PUT    /api/stones/:id/file?path=<rel>       — 写 stone 文件 + commit main (人类侧豁免)
 *
 * 留 S3 issue 补:
 *   - GET    /api/stones                            — list all stones
 *   - POST   /api/stones                            — create stone object
 */
import { Elysia, t } from "elysia";
import {
  readFileFromStone,
  writeFileToStone,
} from "@ooc/core/persistable/file-edit-primitive.js";

export interface StonesModuleConfig {
  baseDir: string;
}

export function buildStonesModule(config: StonesModuleConfig) {
  const { baseDir } = config;

  return new Elysia({ prefix: "/api/stones" })
    // GET stone 文件 (对称 read,替代 ooc-6 时代 /api/stones/:id/self 与 /readable)
    .get(
      "/:id/file",
      async ({ params, query, set }) => {
        const path = typeof query.path === "string" ? query.path : "";
        if (!path) {
          set.status = 400;
          return { ok: false, error: { code: "MISSING_PATH", message: "missing ?path= query" } };
        }
        const result = await readFileFromStone({
          baseDir,
          objectId: params.id,
          path,
        });
        if (!result.ok) {
          set.status =
            result.code === "NOT_FOUND" ? 404 :
            result.code === "NOT_WHITELISTED" ? 400 :
            result.code === "INVALID_PATH" ? 400 :
            result.code === "OUTSIDE_STONE" ? 400 :
            500;
          return { ok: false, error: { code: result.code, message: result.message } };
        }
        return {
          ok: true,
          objectId: result.objectId,
          path: result.path,
          content: result.content,
          size: result.size,
        };
      },
    )
    // PUT stone 文件 (通用 file-edit 原语,人类侧直 commit main 豁免 reflectable feat-branch 纪律)
    .put(
      "/:id/file",
      async ({ params, query, body, set }) => {
        const path = typeof query.path === "string" ? query.path : "";
        if (!path) {
          set.status = 400;
          return { ok: false, error: { code: "MISSING_PATH", message: "missing ?path= query" } };
        }
        const result = await writeFileToStone({
          baseDir,
          objectId: params.id,
          path,
          content: body.content,
          authorObjectId: body.authorObjectId,
        });
        if (!result.ok) {
          set.status =
            result.code === "NOT_WHITELISTED" ? 400 :
            result.code === "INVALID_PATH" ? 400 :
            result.code === "OUTSIDE_STONE" ? 400 :
            500;
          return { ok: false, error: { code: result.code, message: result.message } };
        }
        return {
          ok: true,
          objectId: result.objectId,
          path: result.path,
          commitSha: result.commitSha,
        };
      },
      {
        body: t.Object({
          content: t.String(),
          authorObjectId: t.Optional(t.String()),
        }),
      },
    );
}
