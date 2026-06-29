/**
 * stones module — server module for stone object CRUD + 通用 file-edit 原语 endpoint。
 *
 * **issue S1 (2026-06-29)**: 通用 file-edit/read 原语
 *   GET/PUT /api/stones/:id/file?path=<rel>
 *
 * **issue S3 (2026-06-29)**: stone list + create
 *   GET  /api/stones — list stones/main/objects/
 *   POST /api/stones — 创建 stone object 骨架 (经 versioning commit main)
 */
import { Elysia, t } from "elysia";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readFileFromStone,
  writeFileToStone,
} from "@ooc/core/persistable/file-edit-primitive.js";
import { httpDirectMainWrite } from "@ooc/core/persistable/stone-versioning.js";

export interface StonesModuleConfig {
  baseDir: string;
}

interface StoneListItem {
  objectId: string;
  kind: "class" | "object";
}

async function listStones(baseDir: string): Promise<StoneListItem[]> {
  const objectsRoot = join(baseDir, "stones", "main", "objects");
  let entries;
  try {
    entries = await readdir(objectsRoot, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const items: StoneListItem[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    let kind: "class" | "object" = "object";
    try {
      const sub = await readdir(join(objectsRoot, e.name));
      if (sub.includes("index.ts") || sub.includes("index.tsx")) kind = "class";
    } catch {
      // dir read fail → 当 object
    }
    items.push({ objectId: e.name, kind });
  }
  return items;
}

export function buildStonesModule(config: StonesModuleConfig) {
  const { baseDir } = config;

  return new Elysia({ prefix: "/api/stones" })
    // S3 list stones
    .get(
      "",
      async () => {
        const items = await listStones(baseDir);
        return { items };
      },
    )
    // S3 create stone — 创建 stones/main/objects/<id>/ 骨架并经 versioning commit
    .post(
      "",
      async ({ body, set }) => {
        const objectId = body.objectId;
        if (!objectId || objectId.includes("..") || objectId.startsWith("/") || objectId.includes("\0")) {
          set.status = 400;
          return { ok: false, error: { code: "INVALID_OBJECT_ID", message: "invalid objectId" } };
        }
        const existing = await listStones(baseDir);
        if (existing.some((s) => s.objectId === objectId)) {
          return { ok: true, objectId, dir: `stones/main/objects/${objectId}`, created: false };
        }
        const result = await httpDirectMainWrite({
          baseDir,
          authorObjectId: objectId,
          intent: `[stone-create] ${objectId}`,
          write: async () => {
            const dir = join(baseDir, "stones", "main", "objects", objectId);
            await mkdir(dir, { recursive: true });
            await writeFile(
              join(dir, "package.json"),
              JSON.stringify({ name: `@ooc/${objectId}`, ooc: { objectId, kind: body.kind ?? "object" } }, null, 2),
              "utf8",
            );
            await writeFile(
              join(dir, "self.md"),
              `# ${objectId}\n\n(placeholder, edit via PUT /api/stones/${objectId}/file?path=self.md)\n`,
              "utf8",
            );
          },
        });
        if (!result.ok) {
          set.status = 500;
          return { ok: false, error: { code: result.code, message: result.message } };
        }
        return {
          ok: true,
          objectId,
          dir: `stones/main/objects/${objectId}`,
          created: true,
          commitSha: result.commitSha,
        };
      },
      {
        body: t.Object({
          objectId: t.String(),
          kind: t.Optional(t.Union([t.Literal("class"), t.Literal("object")])),
        }),
      },
    )
    // S1 GET stone 文件
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
    // S1 PUT stone 文件
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
