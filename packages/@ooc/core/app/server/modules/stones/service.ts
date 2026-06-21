import {
  createStoneObject,
  createPoolObject,
  httpDirectMainWrite,
  poolKnowledgeDir,
  readExecutableSource,
  readReadable,
  stoneDir,
  writeReadable,
} from "@ooc/core/persistable";
import { readSelf, writeSelf } from "@ooc/builtins/agent/persistable/self-md.js";
import type { StoneRegistry } from "@ooc/core/runtime/stone-registry";
import { parseKnowledgeFile, parseActivatesOn } from "@ooc/core/thinkable/knowledge";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { AppServerError } from "../../bootstrap/errors";
import type { HttpDirectMainWriteResult } from "@ooc/core/persistable";

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

const EDITABLE_STONE_EXACT = new Set(["self.md", "readable.md", "executable/index.ts", "visible/index.tsx"]);
const KNOWLEDGE_PREFIX = "knowledge/";

/**
 * path 三层防护：
 * 1. NUL / 绝对路径 / `..` segment（复用 safeKnowledgePath 逻辑）
 * 2. 白名单——精确匹配 EDITABLE_STONE_EXACT 或 knowledge/ 前缀（子路径同样防穿越，限 .md）
 * 3. 其余（package.json / .git / node_modules / types.ts / 根 index.ts 等）一律拒绝
 *
 * 返回规范化 relPath（使用平台 sep）。
 */
function assertEditableStonePath(path: string, objectId: string): string {
  // 层 1：复用 safeKnowledgePath 的 NUL / 绝对 / .. 校验
  const relPath = safeKnowledgePath(path);
  // 规范化为 POSIX 风格做白名单比对（sep 可能是 \ on Windows）
  const posix = relPath.split(sep).join("/");
  // 层 2+3：白名单
  if (EDITABLE_STONE_EXACT.has(posix)) return relPath;
  if (posix.startsWith(KNOWLEDGE_PREFIX)) {
    const sub = posix.slice(KNOWLEDGE_PREFIX.length);
    if (!sub || sub.includes("/")) {
      // 不允许 knowledge/ 本身或多级子路径
      throw new AppServerError("INVALID_INPUT", `path '${path}' is not an editable stone file`, { objectId, path });
    }
    if (!sub.endsWith(".md")) {
      throw new AppServerError("INVALID_INPUT", `path '${path}' is not an editable stone file`, { objectId, path });
    }
    return relPath;
  }
  throw new AppServerError("INVALID_INPUT", `path '${path}' is not an editable stone file`, { objectId, path });
}

/**
 * 写入 knowledge 后的「活不活」体检（thinkable 维度）。
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

export function createStonesService({
  baseDir,
  stoneRegistry,
}: {
  baseDir: string;
  stoneRegistry?: StoneRegistry;
}) {
  const ref = (objectId: string) => ({ baseDir, objectId });
  const dir = (objectId: string) => stoneDir(ref(objectId));

  /**
   * HTTP 控制面写 stone → 直接 commit main（persistable.httpDirectMainWrite，所见即所得，
   * 不开 session worktree）。失败转 AppServerError；成功结果原样返回（caller 拼 response body）。
   */
  async function runVersioned(
    objectId: string,
    intent: string,
    write: (branch: string) => Promise<void>,
  ): Promise<Extract<HttpDirectMainWriteResult, { ok: true }>> {
    const r = await httpDirectMainWrite({ baseDir, authorObjectId: objectId, intent, write });
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
   * 资源存在性前置校验。
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
   * 覆盖性写入前置校验。
   *
   * 若目标文件已存在**且非空**,要求 caller 显式带 confirm=true 才允许覆盖;否则抛
   * OVERWRITE_REQUIRES_CONFIRM(409)。confirm=false 时若文件不存在或为空占位,允许首次写入。
   *
   * 校验由 route 层从 `X-Overwrite-Confirm: true` header 派生 boolean 传入。
   *
   * 空文件等价于"未写过"：size===0 视为等价 ENOENT 放行，对应 protection 的初衷
   * （避免覆盖用户已经写过的内容；空文件不算内容）。
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
      if (!stoneRegistry) {
        throw new AppServerError("INTERNAL_ERROR", "listStones requires stoneRegistry", {});
      }
      await stoneRegistry.rescan();
      return {
        items: stoneRegistry
          .listByKind("stone")
          .map((s) => ({ objectId: s.objectId, dir: s.dir }))
          .sort((a, b) => a.objectId.localeCompare(b.objectId)),
      };
    },
    async createStone({
      objectId,
      name,
      self,
      readable,
      class: classId,
    }: {
      objectId?: string;
      name?: string;
      self?: string;
      readable?: string;
      /** ooc.class —— object 的继承父类（class 实例化时设置）。 */
      class?: string;
    }) {
      objectId = safeObjectId(objectId, name);
      // pool 骨架在 stones/ 之外（pools/objects/<id>/），与 git versioning 无关；
      // 提前建好，避免 worktree write 之后还要等 commit。
      await createPoolObject({ baseDir, objectId });
      // stone 目录 + self.md + readable.md 全部经 worktree → commit → ff merge。
      // 同一个 commit 涵盖 createStoneObject + 可选的 self/readable overwrite，避免拆分多个 commit。
      const versioned = await runVersioned(objectId, `http:createStone ${objectId}`, async (branch) => {
        const wtRef = { baseDir, objectId, _stonesBranch: branch };
        await createStoneObject(wtRef, classId ? { class: classId } : undefined);
        // self.md 协议（visible.display_name_from_self_md）：首行 = displayName。
        // 显式 self 文本优先；否则把 name 写成首行（提供有意义的 displayName）。
        // 仅 agent（class=_builtin/agent）有 self.md；非 agent 无 self.md，displayName 降级 objectId。
        const isAgent = classId === "_builtin/agent";
        if (isAgent) {
          if (self !== undefined) {
            await writeSelf(wtRef, self);
          } else if (name !== undefined) {
            await writeSelf(wtRef, name);
          }
        }
        if (readable !== undefined) await writeReadable(wtRef, readable);
      });
      return {
        objectId,
        dir: dir(objectId),
        created: true,
        commitSha: versioned.commitSha,
        merged: versioned.merged,
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
    async getReadable({ objectId }: { objectId: string }) {
      await ensureStoneExists(objectId);
      return { text: (await readReadable(ref(objectId))) ?? "" };
    },
    async getServerSource({ objectId }: { objectId: string }) {
      await ensureStoneExists(objectId);
      return { code: (await readExecutableSource(ref(objectId))) ?? "" };
    },
    async putFile({
      objectId,
      path,
      content,
      confirmOverwrite = false,
    }: {
      objectId: string;
      path: string;
      content: string;
      confirmOverwrite?: boolean;
    }) {
      await ensureStoneExists(objectId);
      const relPath = assertEditableStonePath(path, objectId);
      await ensureOverwriteAllowed(join(dir(objectId), relPath), confirmOverwrite, { objectId, path: relPath });
      const versioned = await runVersioned(objectId, `http:putFile ${objectId} ${relPath}`, async (branch) => {
        const target = join(stoneDir({ baseDir, objectId, _stonesBranch: branch }), relPath);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
      });
      return { ok: true, commitSha: versioned.commitSha, merged: versioned.merged };
    },
    async createKnowledgeDirectory({ objectId, path }: { objectId: string; path: string }) {
      await ensureStoneExists(objectId);
      // knowledge 已迁到 pool 层；HTTP 仍由 stones API 入口 expose 但落点改了。
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
  };
}
