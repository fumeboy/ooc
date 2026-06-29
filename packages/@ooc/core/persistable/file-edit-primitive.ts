/**
 * file-edit / file-read 通用原语层 (issue S1, 2026-06-29)。
 *
 * **设计权威**: `.ooc-world-meta/.../objects/supervisor/children/app/self.md` L16
 * (源文件编辑收口为单一 file-edit 原语 `PUT /api/stones/:id/file?path=`)。
 *
 * 三层 path 防护:
 * 1. **safePath**: 拒绝 NUL / 绝对路径 / `..` 段
 * 2. **whitelist**: 仅允许设计权威列出的源文件白名单(self.md / readable.md / executable/
 *    index.ts / visible/index.tsx / knowledge/*.md);拒绝默认,禁 package.json / .git / node_modules / types.ts
 * 3. **ensureInside**: 解析后绝对路径必须在 stone 目录内,防 symlink 穿透
 *
 * write 走 `httpDirectMainWrite`(human direct commit main,豁免 reflectable feat-branch 纪律);
 * read 走 fs.readFile(同三层防护)。
 *
 * **铁律边界**(对齐 `## reflectable × persistable` 自我迭代铁律):本原语只服务**人类侧**
 * (HTTP 控制面);agent 自我迭代的 stone 写仍经 reflectable feat-branch PR(见
 * filesystem.write_file + super flow create_pr_for_class_edits 通路)。
 */
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";
import { httpDirectMainWrite } from "./stone-versioning.js";

/** path 白名单 — 设计权威 app/self.md L16 列举。 */
const ALLOWED_FILE_PATTERNS: RegExp[] = [
  /^self\.md$/,
  /^readable\.md$/,
  /^executable\/index\.ts$/,
  /^visible\/index\.tsx$/,
  /^visible\/server\/index\.ts$/, // S2 issue 引入 visible/server 模块, 同走 file-edit
  /^knowledge\/[^/]+\.md$/,
];

export type PathError =
  | { code: "INVALID_PATH"; message: string }
  | { code: "NOT_WHITELISTED"; message: string }
  | { code: "OUTSIDE_STONE"; message: string };

/**
 * 单一 path 验证入口 — 三层防护合一,返 ok | error。
 *
 * - `path` 相对于 stone 目录 `stones/main/objects/<objectId>/`,不含前导 /
 * - 命中任一防护即返 error,白名单不命中也返 error
 */
export function validateFilePath(
  baseDir: string,
  objectId: string,
  path: string,
): { ok: true; absPath: string } | { ok: false; error: PathError } {
  // 1. safePath: 拒绝 NUL / 绝对路径 / `..` 段
  if (path.includes("\0")) {
    return { ok: false, error: { code: "INVALID_PATH", message: "path contains NUL" } };
  }
  if (isAbsolute(path)) {
    return { ok: false, error: { code: "INVALID_PATH", message: "path must be relative" } };
  }
  if (path.split("/").some((seg) => seg === "..")) {
    return { ok: false, error: { code: "INVALID_PATH", message: "path contains '..' segment" } };
  }

  // 2. whitelist
  const normalized = normalize(path).replace(/^\.\//, "");
  if (!ALLOWED_FILE_PATTERNS.some((re) => re.test(normalized))) {
    return {
      ok: false,
      error: {
        code: "NOT_WHITELISTED",
        message: `path "${path}" not in whitelist (allowed: self.md, readable.md, executable/index.ts, visible/index.tsx, visible/server/index.ts, knowledge/*.md)`,
      },
    };
  }

  // 3. ensureInside: 解析后必须仍在 stone 目录内
  const stoneDir = join(baseDir, "stones", "main", "objects", objectId);
  const absPath = join(stoneDir, normalized);
  const rel = relative(stoneDir, absPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return {
      ok: false,
      error: { code: "OUTSIDE_STONE", message: `path resolves outside stone dir: ${absPath}` },
    };
  }

  return { ok: true, absPath };
}

export type FileEditResult =
  | { ok: true; objectId: string; path: string; commitSha: string }
  | { ok: false; code: string; message: string };

/**
 * 把人类侧编辑的文件内容写入 stone 并 commit main。
 *
 * - path 三层防护
 * - 经 httpDirectMainWrite 串行化(per baseDir queue)+ commit main 直写
 * - 抛错均被捕获包成 { ok: false, code, message }
 */
export async function writeFileToStone(input: {
  baseDir: string;
  objectId: string;
  path: string;
  content: string;
  authorObjectId?: string;
}): Promise<FileEditResult> {
  const v = validateFilePath(input.baseDir, input.objectId, input.path);
  if (!v.ok) return { ok: false, code: v.error.code, message: v.error.message };

  const author = input.authorObjectId ?? "user";
  const result = await httpDirectMainWrite({
    baseDir: input.baseDir,
    authorObjectId: input.objectId,
    intent: `[human-edit] ${input.objectId}/${input.path}`,
    write: async () => {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(v.absPath), { recursive: true });
      await writeFile(v.absPath, input.content, "utf8");
    },
  });
  void author;
  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  return { ok: true, objectId: input.objectId, path: input.path, commitSha: result.commitSha };
}

export type FileReadResult =
  | { ok: true; objectId: string; path: string; content: string; size: number }
  | { ok: false; code: string; message: string };

/**
 * 读 stone 内某文件 — 三层防护 + fs.readFile。
 *
 * 替代 ooc-6 时代专用 `/api/stones/:id/self` 与 `/api/stones/:id/readable` 两端点。
 */
export async function readFileFromStone(input: {
  baseDir: string;
  objectId: string;
  path: string;
}): Promise<FileReadResult> {
  const v = validateFilePath(input.baseDir, input.objectId, input.path);
  if (!v.ok) return { ok: false, code: v.error.code, message: v.error.message };

  try {
    const st = await stat(v.absPath);
    if (!st.isFile()) {
      return { ok: false, code: "NOT_FILE", message: `not a regular file: ${input.path}` };
    }
    const content = await readFile(v.absPath, "utf8");
    return {
      ok: true,
      objectId: input.objectId,
      path: input.path,
      content,
      size: st.size,
    };
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("ENOENT")) {
      return { ok: false, code: "NOT_FOUND", message: `file not found: ${input.path}` };
    }
    return { ok: false, code: "READ_FAILED", message };
  }
}
