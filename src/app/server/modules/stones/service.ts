import {
  createStoneObject,
  knowledgeDir,
  mergeData,
  readData,
  readReadme,
  readSelf,
  readServerSource,
  stoneDir,
  writeReadme,
  writeSelf,
  writeServerSource,
} from "@src/persistable";
import { loadUiServerMethods } from "@src/executable/server/loader";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { AppServerError } from "../../bootstrap/errors";

function safeObjectId(input: string | undefined, fallback?: string) {
  const value = (input ?? fallback ?? "").trim();
  if (!value || value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new AppServerError("INVALID_INPUT", "stone object name is required and must be a safe directory name", { input });
  }
  return value;
}

function safeKnowledgePath(input: string) {
  if (!input || input.includes("\0") || isAbsolute(input)) {
    throw new AppServerError("INVALID_INPUT", `unsafe knowledge path '${input}'`, { path: input });
  }
  const parts = input.split(/[\\/]+/).filter(Boolean);
  if (parts.some((part) => part === "..")) {
    throw new AppServerError("INVALID_INPUT", `unsafe knowledge path '${input}'`, { path: input });
  }
  return parts.join(sep);
}

function ensureInside(root: string, target: string, details: Record<string, unknown>) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return resolvedTarget;
  throw new AppServerError("INVALID_INPUT", "knowledge path escapes knowledge directory", details);
}

function createHttpMethodContext(dir: string) {
  return {
    self: { dir },
    thread: {
      id: "http",
      inject() {
        // HTTP 调用没有线程上下文，这里保留最小空实现。
      },
    },
  } as never;
}

export function createStonesService({ baseDir, stonesBranch }: { baseDir: string; stonesBranch?: string }) {
  const ref = (objectId: string) => ({ baseDir, objectId, stonesBranch });
  const dir = (objectId: string) => stoneDir(ref(objectId));

  /**
   * Issue #6 Bad #1: 资源存在性前置校验。
   *
   * 在每个 GET/PUT/PATCH 单个 stone 资源前调用;不存在 → 抛 NOT_FOUND,避免
   * 读接口返回 200 + 空内容、写接口对不存在 objectId 静默创建文件。
   *
   * list 接口(listStones)不调本函数;父目录(stones/)不存在时本就该返回 []。
   */
  async function ensureStoneExists(objectId: string): Promise<void> {
    try {
      const stats = await stat(stoneDir(ref(objectId)));
      if (!stats.isDirectory()) {
        throw new AppServerError("NOT_FOUND", `stone '${objectId}' is not a directory`, { objectId });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new AppServerError("NOT_FOUND", `stone '${objectId}' does not exist`, { objectId });
      }
      throw error;
    }
  }

  /**
   * Issue #6 Bad #4: 覆盖性写入前置校验。
   *
   * 若目标文件已存在,要求 caller 显式带 confirm=true 才允许覆盖;否则抛
   * OVERWRITE_REQUIRES_CONFIRM(409)。confirm=false 时若文件不存在,允许首次写入。
   *
   * 校验由 route 层从 `X-Overwrite-Confirm: true` header 派生 boolean 传入。
   */
  async function ensureOverwriteAllowed(
    targetFile: string,
    confirm: boolean,
    details: Record<string, unknown>,
  ): Promise<void> {
    if (confirm) return;
    try {
      await stat(targetFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return; // 首次写入,放行
      throw error;
    }
    throw new AppServerError(
      "OVERWRITE_REQUIRES_CONFIRM",
      `PUT 会覆盖已存在的 ${targetFile} — 如果确实要覆盖, 加 header 'X-Overwrite-Confirm: true'`,
      { ...details, targetFile },
    );
  }

  return {
    async listStones() {
      try {
        // U2: list 当前 stones-branch 下的 Object 目录，而非 stones/ 根（根下是 branch 子目录）
        const entries = await readdir(`${baseDir}/stones/${stonesBranch ?? "main"}`, { withFileTypes: true });
        return {
          items: entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => ({ objectId: entry.name, dir: dir(entry.name) }))
            .sort((a, b) => a.objectId.localeCompare(b.objectId)),
        };
      } catch {
        return { items: [] };
      }
    },
    async createStone({
      objectId,
      name,
      description,
      self,
      readme,
    }: {
      objectId?: string;
      name?: string;
      description?: string;
      self?: string;
      readme?: string;
    }) {
      objectId = safeObjectId(objectId, name);
      await createStoneObject(ref(objectId));
      if (self !== undefined) await writeSelf(ref(objectId), self);
      if (readme !== undefined) await writeReadme(ref(objectId), readme);
      if (name !== undefined || description !== undefined) {
        await mergeData(ref(objectId), {
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
        });
      }
      return { objectId, dir: dir(objectId), created: true };
    },
    async getStone({ objectId }: { objectId: string }) {
      await ensureStoneExists(objectId);
      return { objectId, dir: dir(objectId), exists: true };
    },
    async getSelf({ objectId }: { objectId: string }) {
      await ensureStoneExists(objectId);
      return { text: (await readSelf(ref(objectId))) ?? "" };
    },
    async putSelf({ objectId, text, confirmOverwrite = false }: { objectId: string; text: string; confirmOverwrite?: boolean }) {
      await ensureStoneExists(objectId);
      await ensureOverwriteAllowed(join(dir(objectId), "self.md"), confirmOverwrite, { objectId, field: "self" });
      await writeSelf(ref(objectId), text);
      return { ok: true };
    },
    async getReadme({ objectId }: { objectId: string }) {
      await ensureStoneExists(objectId);
      return { text: (await readReadme(ref(objectId))) ?? "" };
    },
    async putReadme({ objectId, text, confirmOverwrite = false }: { objectId: string; text: string; confirmOverwrite?: boolean }) {
      await ensureStoneExists(objectId);
      await ensureOverwriteAllowed(join(dir(objectId), "readme.md"), confirmOverwrite, { objectId, field: "readme" });
      await writeReadme(ref(objectId), text);
      return { ok: true };
    },
    async getData({ objectId }: { objectId: string }) {
      await ensureStoneExists(objectId);
      return { data: (await readData(ref(objectId))) ?? {} };
    },
    async patchData({ objectId, patch }: { objectId: string; patch: Record<string, unknown> }) {
      await ensureStoneExists(objectId);
      await mergeData(ref(objectId), patch);
      return { ok: true };
    },
    async getServerSource({ objectId }: { objectId: string }) {
      await ensureStoneExists(objectId);
      return { code: (await readServerSource(ref(objectId))) ?? "" };
    },
    async putServerSource({ objectId, code, confirmOverwrite = false }: { objectId: string; code: string; confirmOverwrite?: boolean }) {
      await ensureStoneExists(objectId);
      await ensureOverwriteAllowed(join(dir(objectId), "server", "index.ts"), confirmOverwrite, { objectId, field: "server-source" });
      await writeServerSource(ref(objectId), code);
      return { ok: true };
    },
    async createKnowledgeDirectory({ objectId, path }: { objectId: string; path: string }) {
      await ensureStoneExists(objectId);
      const root = knowledgeDir(ref(objectId));
      const safePath = safeKnowledgePath(path);
      const target = ensureInside(root, join(root, safePath), { objectId, path });
      await mkdir(target, { recursive: true });
      return { objectId, path: safePath.split(sep).join("/"), created: true };
    },
    async createKnowledgeFile({ objectId, path, content = "" }: { objectId: string; path: string; content?: string }) {
      await ensureStoneExists(objectId);
      const root = knowledgeDir(ref(objectId));
      const safePath = safeKnowledgePath(path);
      const target = ensureInside(root, join(root, safePath), { objectId, path });
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      return { objectId, path: safePath.split(sep).join("/"), created: true };
    },
    async putKnowledgeFile({ objectId, path, content = "", confirmOverwrite = false }: { objectId: string; path: string; content?: string; confirmOverwrite?: boolean }) {
      await ensureStoneExists(objectId);
      const root = knowledgeDir(ref(objectId));
      const safePath = safeKnowledgePath(path);
      const target = ensureInside(root, join(root, safePath), { objectId, path });
      await ensureOverwriteAllowed(target, confirmOverwrite, { objectId, path });
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      return { objectId, path: safePath.split(sep).join("/"), ok: true };
    },
    async callMethod({ objectId, method, args = {} }: { objectId: string; method: string; args?: Record<string, unknown> }) {
      await ensureStoneExists(objectId);
      let methods;
      try {
        methods = await loadUiServerMethods(ref(objectId));
      } catch (error) {
        throw new AppServerError(
          "METHOD_LOAD_FAILED",
          `failed to load ui_methods for stone ${objectId}: ${(error as Error).message}`,
          { objectId, method }
        );
      }
      const entry = methods[method];
      if (!entry) {
        throw new AppServerError(
          "METHOD_NOT_FOUND",
          `ui method '${method}' not found on stone '${objectId}'`,
          { objectId, method, available: Object.keys(methods) }
        );
      }
      try {
        return {
          returnValue: await entry.fn(createHttpMethodContext(dir(objectId)), args),
        };
      } catch (error) {
        throw new AppServerError(
          "INTERNAL_ERROR",
          `ui method '${method}' threw: ${(error as Error).message}`,
          { objectId, method }
        );
      }
    },
  };
}
