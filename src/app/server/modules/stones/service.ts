import {
  createStoneObject,
  createPoolObject,
  poolKnowledgeDir,
  readReadme,
  readSelf,
  readExecutableSource,
  stoneDir,
  writeReadme,
  writeSelf,
  writeExecutableSource,
} from "@src/persistable";
import { loadUiServerMethods } from "@src/executable/server/loader";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { AppServerError } from "../../bootstrap/errors";
import { wrapHttpWriteInWorktree, type HttpWriteOk } from "./versioning-helper";

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
   * 根因 #2：把 wrapHttpWriteInWorktree 的失败结果转 AppServerError。
   * 成功结果原样返回（caller 在外层拼到 response body）。
   */
  async function runVersioned(
    objectId: string,
    intent: string,
    write: (worktreeBranch: string) => Promise<void>,
  ): Promise<HttpWriteOk> {
    const r = await wrapHttpWriteInWorktree({
      baseDir,
      authorObjectId: objectId,
      intent,
      write: async ({ branch }) => write(branch),
    });
    if (!r.ok) {
      throw new AppServerError("INTERNAL_ERROR", `versioned write failed (${r.code}): ${r.message}`, {
        objectId,
        intent,
        code: r.code,
      });
    }
    return r;
  }

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
   * 若目标文件已存在**且非空**,要求 caller 显式带 confirm=true 才允许覆盖;否则抛
   * OVERWRITE_REQUIRES_CONFIRM(409)。confirm=false 时若文件不存在或为空占位,允许首次写入。
   *
   * 校验由 route 层从 `X-Overwrite-Confirm: true` header 派生 boolean 传入。
   *
   * 空文件等价于"未写过"（2026-05-24）：createStoneObject 现在预创 self.md / readme.md 空文件
   * 作为 visibility-first 占位；这里把 size===0 视为等价 ENOENT 放行，对应 protection 的初衷
   * （避免覆盖用户已经写过的内容，空占位不算内容）。
   */
  async function ensureOverwriteAllowed(
    targetFile: string,
    confirm: boolean,
    details: Record<string, unknown>,
  ): Promise<void> {
    if (confirm) return;
    let size: number;
    try {
      const st = await stat(targetFile);
      size = st.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return; // 首次写入,放行
      throw error;
    }
    if (size === 0) return; // 空占位（如 createStoneObject 预创）视为未写过,放行
    throw new AppServerError(
      "OVERWRITE_REQUIRES_CONFIRM",
      `PUT 会覆盖已存在的 ${targetFile} — 如果确实要覆盖, 加 header 'X-Overwrite-Confirm: true'`,
      { ...details, targetFile },
    );
  }

  return {
    async listStones() {
      try {
        // U2 + 2026-05-21: list 当前 stones-branch 的 objects/ 子目录下的 Object
        // 目录（stones/{branch}/objects/{objectId}/）；branch 根本身现在保留给
        // world-level stone 资源使用。
        const entries = await readdir(`${baseDir}/stones/${stonesBranch ?? "main"}/objects`, { withFileTypes: true });
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
      self,
      readme,
    }: {
      objectId?: string;
      name?: string;
      self?: string;
      readme?: string;
    }) {
      objectId = safeObjectId(objectId, name);
      // pool 骨架在 stones/ 之外（pools/objects/<id>/），与 git versioning 无关；
      // 提前建好，避免 worktree write 之后还要等 commit。
      await createPoolObject({ baseDir, objectId });
      // 根因 #2：stone 目录 + self.md + readme.md 全部经 worktree → commit → ff merge。
      // 同一个 commit 涵盖 createStoneObject + 可选的 self/readme overwrite，避免拆分多个 commit。
      const versioned = await runVersioned(objectId, `http:createStone ${objectId}`, async (branch) => {
        const wtRef = { baseDir, objectId, stonesBranch: branch };
        await createStoneObject(wtRef);
        // self.md 协议（visible.display_name_from_self_md）：首行 = displayName。
        // 显式 self 文本优先；否则把 name 写成首行（提供有意义的 displayName）。
        if (self !== undefined) {
          await writeSelf(wtRef, self);
        } else if (name !== undefined) {
          await writeSelf(wtRef, name);
        }
        if (readme !== undefined) await writeReadme(wtRef, readme);
      });
      return {
        objectId,
        dir: dir(objectId),
        created: true,
        commitSha: versioned.commitSha,
        merged: versioned.merged,
        prIssueId: versioned.prIssueId,
      };
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
      const versioned = await runVersioned(objectId, `http:putSelf ${objectId}`, async (branch) => {
        await writeSelf({ baseDir, objectId, stonesBranch: branch }, text);
      });
      return { ok: true, commitSha: versioned.commitSha, merged: versioned.merged, prIssueId: versioned.prIssueId };
    },
    async getReadme({ objectId }: { objectId: string }) {
      await ensureStoneExists(objectId);
      return { text: (await readReadme(ref(objectId))) ?? "" };
    },
    async putReadme({ objectId, text, confirmOverwrite = false }: { objectId: string; text: string; confirmOverwrite?: boolean }) {
      await ensureStoneExists(objectId);
      await ensureOverwriteAllowed(join(dir(objectId), "readme.md"), confirmOverwrite, { objectId, field: "readme" });
      const versioned = await runVersioned(objectId, `http:putReadme ${objectId}`, async (branch) => {
        await writeReadme({ baseDir, objectId, stonesBranch: branch }, text);
      });
      return { ok: true, commitSha: versioned.commitSha, merged: versioned.merged, prIssueId: versioned.prIssueId };
    },
    async getExecutableSource({ objectId }: { objectId: string }) {
      await ensureStoneExists(objectId);
      return { code: (await readExecutableSource(ref(objectId))) ?? "" };
    },
    async putExecutableSource({ objectId, code, confirmOverwrite = false }: { objectId: string; code: string; confirmOverwrite?: boolean }) {
      await ensureStoneExists(objectId);
      await ensureOverwriteAllowed(join(dir(objectId), "executable", "index.ts"), confirmOverwrite, { objectId, field: "executable-source" });
      const versioned = await runVersioned(objectId, `http:putExecutableSource ${objectId}`, async (branch) => {
        await writeExecutableSource({ baseDir, objectId, stonesBranch: branch }, code);
      });
      return { ok: true, commitSha: versioned.commitSha, merged: versioned.merged, prIssueId: versioned.prIssueId };
    },
    async createKnowledgeDirectory({ objectId, path }: { objectId: string; path: string }) {
      await ensureStoneExists(objectId);
      // 2026-05-23: knowledge 已迁到 pool 层；HTTP 仍由 stones API 入口 expose 但落点改了。
      const root = poolKnowledgeDir({ baseDir, objectId });
      const safePath = safeKnowledgePath(path);
      const target = ensureInside(root, join(root, safePath), { objectId, path });
      await mkdir(target, { recursive: true });
      return { objectId, path: safePath.split(sep).join("/"), created: true };
    },
    async createKnowledgeFile({ objectId, path, content = "" }: { objectId: string; path: string; content?: string }) {
      await ensureStoneExists(objectId);
      const root = poolKnowledgeDir({ baseDir, objectId });
      const safePath = safeKnowledgePath(path);
      const target = ensureInside(root, join(root, safePath), { objectId, path });
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      return { objectId, path: safePath.split(sep).join("/"), created: true };
    },
    async putKnowledgeFile({ objectId, path, content = "", confirmOverwrite = false }: { objectId: string; path: string; content?: string; confirmOverwrite?: boolean }) {
      await ensureStoneExists(objectId);
      const root = poolKnowledgeDir({ baseDir, objectId });
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
