import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { AppServerError } from "../../bootstrap/errors";
import type { TreeScope, UiTreeNode } from "./model";

type Dirent = Awaited<ReturnType<typeof readdir>>[number];

function toWebPath(path: string) {
  return path.split(sep).filter(Boolean).join("/");
}

function assertSafeRelativePath(input: string) {
  if (!input || input === ".") return "";
  if (input.startsWith("/") || input.includes("\0")) {
    throw new AppServerError("INVALID_INPUT", `unsafe path '${input}'`, { path: input });
  }
  const segments = input.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment === "..")) {
    throw new AppServerError("INVALID_INPUT", `unsafe path '${input}'`, { path: input });
  }
  return segments.join(sep);
}

function ensureInsideBase(baseDir: string, target: string, details: Record<string, unknown>) {
  const base = resolve(baseDir);
  const resolved = resolve(target);
  const rel = relative(base, resolved);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return resolved;
  }
  throw new AppServerError("INVALID_INPUT", `path escapes world directory`, details);
}

function scopeRoot(baseDir: string, scope: TreeScope) {
  if (scope === "flows") return join(baseDir, "flows");
  if (scope === "stones") return join(baseDir, "stones");
  return baseDir;
}

function scopePrefix(scope: TreeScope) {
  if (scope === "world") return "";
  return scope;
}

function markerFor(nodePath: string): UiTreeNode["marker"] | undefined {
  const parts = nodePath.split("/");
  if (parts.length === 2 && parts[0] === "flows") return "flow";
  if (parts.length === 2 && parts[0] === "stones") return "stone";
  return undefined;
}

export function createUiService({ baseDir }: { baseDir: string }) {
  async function treeNode(absPath: string, relativeToWorld: string, entryName: string): Promise<UiTreeNode> {
    const info = await stat(absPath);
    if (!info.isDirectory()) {
      return {
        name: entryName,
        type: "file",
        path: toWebPath(relativeToWorld),
        size: info.size,
      };
    }

    let entries: Dirent[] = [];
    try {
      entries = await readdir(absPath, { withFileTypes: true });
    } catch {
      entries = [];
    }
    const children = await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith("."))
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
        .map((entry) => treeNode(join(absPath, entry.name), join(relativeToWorld, entry.name), entry.name))
    );

    const webPath = toWebPath(relativeToWorld);
    return {
      name: entryName,
      type: "directory",
      path: webPath,
      marker: markerFor(webPath),
      children,
    };
  }

  return {
    async getTree({ scope, path = "" }: { scope: TreeScope; path?: string }) {
      const safePath = assertSafeRelativePath(path);
      const root = scopeRoot(baseDir, scope);
      const prefix = scopePrefix(scope);
      const absPath = ensureInsideBase(baseDir, join(root, safePath), { scope, path });
      let info;
      try {
        info = await stat(absPath);
      } catch {
        throw new AppServerError("NOT_FOUND", `tree path not found: ${path || scope}`, { scope, path });
      }
      if (!info.isDirectory()) {
        throw new AppServerError("INVALID_INPUT", `tree path is not a directory: ${path}`, { scope, path });
      }
      const rel = toWebPath(join(prefix, safePath));
      return treeNode(absPath, rel, basename(absPath));
    },

    async getFile(path: string) {
      const safePath = assertSafeRelativePath(path);
      const absPath = ensureInsideBase(baseDir, join(baseDir, safePath), { path });
      let info;
      try {
        info = await stat(absPath);
      } catch {
        throw new AppServerError("NOT_FOUND", `file not found: ${path}`, { path });
      }
      if (!info.isFile()) {
        throw new AppServerError("INVALID_INPUT", `path is not a file: ${path}`, { path });
      }
      return {
        path: toWebPath(safePath),
        content: await readFile(absPath, "utf8"),
        size: info.size,
      };
    },

    /**
     * 读取任意 LLM 视角的文件路径 — 不受 world 隔离限制,服务 UI 中 file_window
     * 详情面板"看 LLM 看到了什么"的预览需求。
     *
     * 仅本地 dev / 调试场景使用;读取任意路径在公开部署应再加策略层。
     *
     * 参数:
     * - path: 绝对路径 或 工作目录相对路径(与 file_window.path 一致)
     * - maxBytes: 软上限,超过则只返回前 maxBytes 并标记 truncated
     */
    async readAnyFile(path: string, maxBytes = 256 * 1024) {
      if (!path || path.includes("\0")) {
        throw new AppServerError("INVALID_INPUT", `unsafe path '${path}'`, { path });
      }
      const absPath = isAbsolute(path) ? path : resolve(process.cwd(), path);
      let info;
      try {
        info = await stat(absPath);
      } catch {
        throw new AppServerError("NOT_FOUND", `file not found: ${path}`, { path });
      }
      if (!info.isFile()) {
        throw new AppServerError("INVALID_INPUT", `path is not a file: ${path}`, { path });
      }
      const buf = await readFile(absPath);
      const truncated = buf.byteLength > maxBytes;
      const slice = truncated ? buf.subarray(0, maxBytes) : buf;
      return {
        path: absPath,
        content: slice.toString("utf8"),
        size: info.size,
        truncated,
      };
    },
  };
}
