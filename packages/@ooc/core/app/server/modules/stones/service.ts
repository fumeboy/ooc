import {
  createStoneObject,
  createPoolObject,
  poolKnowledgeDir,
  readExecutableSource,
  readReadable,
  readSelf,
  stoneDir,
  writeExecutableSource,
  writeReadable,
  writeSelf,
} from "@ooc/core/persistable";
import { loadUiServerMethods } from "@ooc/core/runtime/server-loader";
import type { StoneRegistry } from "@ooc/core/runtime/stone-registry";
import { parseKnowledgeFile, parseActivatesOn } from "@ooc/core/thinkable/knowledge";
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

/**
 * 写入 knowledge 后的「活不活」体检（thinkable 维度，2026-06-05 harness sweep #1）。
 *
 * pool knowledge（sediment）只被 activator 来源消费：computeActivations 逐篇 evaluate
 * 其 frontmatter.activates_on triggers。若一篇 knowledge **没有 activates_on**（或 map 为空），
 * activator 直接 `continue` 跳过——除非使用者手动 open_knowledge pin，否则永不注入 context。
 * 写入 API 此前 200 + {created:true} 无任何提示，使用者难察觉「知识写了但是死的」。
 *
 * 本函数不阻断写入（写入是合法操作；也许使用者就是要先占位再补 trigger），
 * 而是返回一条 warning，让 response 带上诊断。返回 undefined 表示「这篇会被激活」。
 *
 * 三类情形产出 warning：
 * 1. 无 frontmatter / 无 activates_on / activates_on 为空 map → 永不自动激活
 * 2. frontmatter 解析抛错（旧 schema / 非法 YAML 结构）→ loader 会跳过整篇
 * 3. activates_on triggers 全部非法（parseActivatesOn 抛错）→ 同样永不激活
 */
function knowledgeActivationWarning(content: string): string | undefined {
  let parsed: ReturnType<typeof parseKnowledgeFile>;
  try {
    parsed = parseKnowledgeFile(content);
  } catch (err) {
    return (
      `knowledge frontmatter 解析失败：${(err as Error).message}。` +
      `loader 会跳过整篇，该 knowledge 永不进入 context。`
    );
  }
  const on = parsed.frontmatter.activates_on;
  const hasMap = on !== undefined && on !== null && typeof on === "object" && !Array.isArray(on);
  if (!hasMap || Object.keys(on as Record<string, unknown>).length === 0) {
    return (
      `该 knowledge 无 activates_on trigger，将永不自动激活（除非被 open_knowledge 显式 pin）。` +
      `如需自动注入，请在 frontmatter 补 activates_on（如 { "object::root": "show_content" }）。`
    );
  }
  try {
    parseActivatesOn(on, "<written knowledge>");
  } catch (err) {
    return (
      `activates_on trigger 非法：${(err as Error).message}。` +
      `该 knowledge 永不自动激活。`
    );
  }
  return undefined;
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

export function createStonesService({
  baseDir,
  stoneRegistry,
  registerStone,
}: {
  baseDir: string;
  stoneRegistry?: StoneRegistry;
  /** 运行时把新建/改动的 stone 注册进 ObjectRegistry（runtime.registerStone）。非 dev server 必需。 */
  registerStone?: (objectId: string) => Promise<void>;
}) {
  const ref = (objectId: string) => ({ baseDir, objectId });
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
      if (stoneRegistry) {
        await stoneRegistry.rescan();
        return {
          items: stoneRegistry
            .listByKind("stone")
            .map((s) => ({ objectId: s.objectId, dir: s.dir }))
            .sort((a, b) => a.objectId.localeCompare(b.objectId)),
        };
      }

      const items: { objectId: string; dir: string }[] = [];

      async function scan(currentDir: string, idSegments: string[]): Promise<void> {
        const entries = await readdir(currentDir, { withFileTypes: true });
        const hasPackageJson = entries.some((e) => e.isFile() && e.name === "package.json");
        if (hasPackageJson && idSegments.length > 0) {
          const objectId = idSegments.join("/");
          items.push({ objectId, dir: dir(objectId) });
        }
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          if (e.name.startsWith(".")) continue;
          if (e.name.startsWith("@")) continue;
          if (e.name === "children") {
            const childrenDir = join(currentDir, "children");
            const childEntries = await readdir(childrenDir, { withFileTypes: true });
            for (const ce of childEntries) {
              if (!ce.isDirectory() || ce.name.startsWith(".") || ce.name.startsWith("@")) continue;
              await scan(join(childrenDir, ce.name), [...idSegments, ce.name]);
            }
          } else if (idSegments.length === 0) {
            await scan(join(currentDir, e.name), [e.name]);
          }
        }
      }

      try {
        await scan(`${baseDir}/stones`, []);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      try {
        await scan(`${baseDir}/packages`, []);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      const seen = new Set<string>();
      const deduped = items.filter((it) => {
        if (seen.has(it.objectId)) return false;
        seen.add(it.objectId);
        return true;
      });
      return {
        items: deduped.sort((a, b) => a.objectId.localeCompare(b.objectId)),
      };
    },
    async createStone({
      objectId,
      name,
      self,
      readme,
      class: classId,
    }: {
      objectId?: string;
      name?: string;
      self?: string;
      readme?: string;
      /** ooc.class —— object 的继承父类（class 实例化时设置）。 */
      class?: string;
    }) {
      objectId = safeObjectId(objectId, name);
      // pool 骨架在 stones/ 之外（pools/objects/<id>/），与 git versioning 无关；
      // 提前建好，避免 worktree write 之后还要等 commit。
      await createPoolObject({ baseDir, objectId });
      // 根因 #2：stone 目录 + self.md + readme.md 全部经 worktree → commit → ff merge。
      // 同一个 commit 涵盖 createStoneObject + 可选的 self/readme overwrite，避免拆分多个 commit。
      const versioned = await runVersioned(objectId, `http:createStone ${objectId}`, async (branch) => {
        const wtRef = { baseDir, objectId, _stonesBranch: branch };
        await createStoneObject(wtRef, classId ? { class: classId } : undefined);
        // self.md 协议（visible.display_name_from_self_md）：首行 = displayName。
        // 显式 self 文本优先；否则把 name 写成首行（提供有意义的 displayName）。
        if (self !== undefined) {
          await writeSelf(wtRef, self);
        } else if (name !== undefined) {
          await writeSelf(wtRef, name);
        }
        if (readme !== undefined) await writeReadable(wtRef, readme);
      });
      // 运行时注册新 stone 的 type 定义进 ObjectRegistry——不依赖 dev-only 的 hot-reload fs.watch，
      // 让其它对象的 think 上下文立即能用上这个 peer（修 collaborable 惰性注册）。fail-soft：注册失败不阻断创建。
      try {
        await registerStone?.(objectId);
      } catch {
        // 注册失败不影响 stone 已创建的事实；渲染侧已 fail-soft 容忍未注册 type。
      }
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
        await writeSelf({ baseDir, objectId, _stonesBranch: branch }, text);
      });
      return { ok: true, commitSha: versioned.commitSha, merged: versioned.merged, prIssueId: versioned.prIssueId };
    },
    async getReadme({ objectId }: { objectId: string }) {
      await ensureStoneExists(objectId);
      return { text: (await readReadable(ref(objectId))) ?? "" };
    },
    async putReadme({ objectId, text, confirmOverwrite = false }: { objectId: string; text: string; confirmOverwrite?: boolean }) {
      await ensureStoneExists(objectId);
      await ensureOverwriteAllowed(join(dir(objectId), "readable.md"), confirmOverwrite, { objectId, field: "readme" });
      const versioned = await runVersioned(objectId, `http:putReadme ${objectId}`, async (branch) => {
        await writeReadable({ baseDir, objectId, _stonesBranch: branch }, text);
      });
      return { ok: true, commitSha: versioned.commitSha, merged: versioned.merged, prIssueId: versioned.prIssueId };
    },
    async getServerSource({ objectId }: { objectId: string }) {
      await ensureStoneExists(objectId);
      return { code: (await readExecutableSource(ref(objectId))) ?? "" };
    },
    async putServerSource({ objectId, code, confirmOverwrite = false }: { objectId: string; code: string; confirmOverwrite?: boolean }) {
      await ensureStoneExists(objectId);
      await ensureOverwriteAllowed(join(dir(objectId), "executable", "index.ts"), confirmOverwrite, { objectId, field: "server-source" });
      const versioned = await runVersioned(objectId, `http:putServerSource ${objectId}`, async (branch) => {
        await writeExecutableSource({ baseDir, objectId, _stonesBranch: branch }, code);
      });
      // 重注册：agent 写了新的 server 方法后，非 dev server 也立即生效（修 programmable 自写方法 prod 不 re-register）。
      try { await registerStone?.(objectId); } catch { /* fail-soft：写已成功，注册失败不阻断 */ }
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
      const warning = knowledgeActivationWarning(content);
      return {
        objectId,
        path: safePath.split(sep).join("/"),
        created: true,
        ...(warning ? { warning } : {}),
      };
    },
    async putKnowledgeFile({ objectId, path, content = "", confirmOverwrite = false }: { objectId: string; path: string; content?: string; confirmOverwrite?: boolean }) {
      await ensureStoneExists(objectId);
      const root = poolKnowledgeDir({ baseDir, objectId });
      const safePath = safeKnowledgePath(path);
      const target = ensureInside(root, join(root, safePath), { objectId, path });
      await ensureOverwriteAllowed(target, confirmOverwrite, { objectId, path });
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      const warning = knowledgeActivationWarning(content);
      return {
        objectId,
        path: safePath.split(sep).join("/"),
        ok: true,
        ...(warning ? { warning } : {}),
      };
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
