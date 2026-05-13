import {
  createStoneObject,
  knowledgeDir,
  mergeData,
  readData,
  readReadme,
  readSelf,
  readServerSource,
  writeReadme,
  writeSelf,
  writeServerSource,
} from "@src/persistable";
import { loadUiServerMethods } from "@src/executable/server/loader";
import { mkdir, readdir, writeFile } from "node:fs/promises";
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

export function createStonesService({ baseDir }: { baseDir: string }) {
  const ref = (objectId: string) => ({ baseDir, objectId });
  const dir = (objectId: string) => `${baseDir}/stones/${objectId}`;

  return {
    async listStones() {
      try {
        const entries = await readdir(`${baseDir}/stones`, { withFileTypes: true });
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
      return { objectId, dir: dir(objectId), exists: true };
    },
    async getSelf({ objectId }: { objectId: string }) {
      return { text: (await readSelf(ref(objectId))) ?? "" };
    },
    async putSelf({ objectId, text }: { objectId: string; text: string }) {
      await writeSelf(ref(objectId), text);
      return { ok: true };
    },
    async getReadme({ objectId }: { objectId: string }) {
      return { text: (await readReadme(ref(objectId))) ?? "" };
    },
    async putReadme({ objectId, text }: { objectId: string; text: string }) {
      await writeReadme(ref(objectId), text);
      return { ok: true };
    },
    async getData({ objectId }: { objectId: string }) {
      return { data: (await readData(ref(objectId))) ?? {} };
    },
    async patchData({ objectId, patch }: { objectId: string; patch: Record<string, unknown> }) {
      await mergeData(ref(objectId), patch);
      return { ok: true };
    },
    async getServerSource({ objectId }: { objectId: string }) {
      return { code: (await readServerSource(ref(objectId))) ?? "" };
    },
    async putServerSource({ objectId, code }: { objectId: string; code: string }) {
      await writeServerSource(ref(objectId), code);
      return { ok: true };
    },
    async createKnowledgeDirectory({ objectId, path }: { objectId: string; path: string }) {
      const root = knowledgeDir(ref(objectId));
      const safePath = safeKnowledgePath(path);
      const target = ensureInside(root, join(root, safePath), { objectId, path });
      await mkdir(target, { recursive: true });
      return { objectId, path: safePath.split(sep).join("/"), created: true };
    },
    async createKnowledgeFile({ objectId, path, content = "" }: { objectId: string; path: string; content?: string }) {
      const root = knowledgeDir(ref(objectId));
      const safePath = safeKnowledgePath(path);
      const target = ensureInside(root, join(root, safePath), { objectId, path });
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      return { objectId, path: safePath.split(sep).join("/"), created: true };
    },
    async putKnowledgeFile({ objectId, path, content = "" }: { objectId: string; path: string; content?: string }) {
      const root = knowledgeDir(ref(objectId));
      const safePath = safeKnowledgePath(path);
      const target = ensureInside(root, join(root, safePath), { objectId, path });
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      return { objectId, path: safePath.split(sep).join("/"), ok: true };
    },
    async callMethod({ objectId, method, args = {} }: { objectId: string; method: string; args?: Record<string, unknown> }) {
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
