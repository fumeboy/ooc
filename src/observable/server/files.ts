import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** 文件树节点 */
export interface FileTreeNode {
  name: string;
  type: "file" | "directory";
  path: string;
  size?: number;
  children?: FileTreeNode[];
  /** 目录标记：stone 或 flow（目录下存在 .stone 或 .flow 文件时设置） */
  marker?: "stone" | "flow";
}

/** 需要从文件树中隐藏的标记文件 */
const MARKER_FILES = new Set([".stone", ".flow"]);

/**
 * 递归构建文件树 JSON
 *
 * @param absDir - 要扫描的绝对路径
 * @param relativePath - 相对于 user 根目录的路径前缀
 * @param maxDepth - 最大递归深度（防止过深）
 */
export function buildFileTree(absDir: string, relativePath: string, maxDepth = 8): FileTreeNode | null {
  if (!existsSync(absDir) || maxDepth <= 0) return null;

  const stat = statSync(absDir);
  const name = absDir.split("/").pop()!;

  if (!stat.isDirectory()) {
    return { name, type: "file", path: relativePath, size: stat.size };
  }

  const entries = readdirSync(absDir, { withFileTypes: true });
  const children: FileTreeNode[] = [];

  let marker: "stone" | "flow" | undefined;
  if (existsSync(join(absDir, ".stone"))) marker = "stone";
  else if (existsSync(join(absDir, ".flow"))) marker = "flow";

  for (const entry of entries) {
    if (MARKER_FILES.has(entry.name)) continue;

    const childAbs = join(absDir, entry.name);
    const childRel = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const subtree = buildFileTree(childAbs, childRel, maxDepth - 1);
      if (subtree) children.push(subtree);
    } else {
      const s = statSync(childAbs);
      children.push({ name: entry.name, type: "file", path: childRel, size: s.size });
    }
  }

  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const node: FileTreeNode = { name, type: "directory", path: relativePath, children };
  if (marker) node.marker = marker;
  return node;
}

/** 文件信息 */
export interface FileInfo {
  name: string;
  size: number;
  modifiedAt: number;
}

/** 递归列出 files 目录下的所有文件 */
export function listFilesInDir(filesDir: string, prefix = ""): FileInfo[] {
  if (!existsSync(filesDir)) return [];
  const entries = readdirSync(filesDir, { withFileTypes: true });
  const files: FileInfo[] = [];

  for (const entry of entries) {
    const entryPath = join(filesDir, entry.name);
    const relativeName = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFilesInDir(entryPath, relativeName));
    } else {
      const stat = statSync(entryPath);
      files.push({
        name: relativeName,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
      });
    }
  }

  return files;
}
