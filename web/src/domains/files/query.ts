import { endpoints } from "../../transport/endpoints";
import { qs, requestJson } from "../../transport/http";
import type { AnyFileContent, FileContent, FileTreeNode, TreeScope } from "./model";

/**
 * Scope → path mapping for ooc-3 tree endpoint.
 * ooc-3 has no scope param; we map scope to a relative path under worldRoot.
 */
function scopeToPath(scope: TreeScope, path?: string): string {
  if (path) return path;
  switch (scope) {
    case "flows": return "flows";
    case "stones": return "stones";
    case "pools": return "pools";
    case "world":
    default: return "";
  }
}

/**
 * Normalize a FileTreeNode from ooc-3 shape (type="dir") to ooc-2 shape (type="directory").
 */
function normalizeNode(node: FileTreeNode): FileTreeNode {
  const type = node.type === "dir" ? "directory" : node.type;
  const children = node.children?.map(normalizeNode);
  return { ...node, type, children };
}

/**
 * Fetch tree from ooc-3 backend with recursive support.
 * Returns a FileTreeNode root (ooc-2 compatible shape with type="directory").
 */
export async function fetchTree(scope: TreeScope, path?: string): Promise<FileTreeNode> {
  const treePath = scopeToPath(scope, path);
  const res = await requestJson<{
    ok: boolean;
    path: string;
    entries: Array<{ name: string; type: "file" | "dir" }>;
    root?: FileTreeNode;
  }>(`${endpoints.tree}${qs({ path: treePath, recursive: "true" })}`);

  // If backend returned recursive tree root, use it (normalized)
  if (res.root) {
    return normalizeNode(res.root);
  }

  // Fall back to flat entries → synthetic root node
  const children: FileTreeNode[] = (res.entries ?? []).map((e) => ({
    name: e.name,
    type: e.type === "dir" ? "directory" : "file",
    path: treePath ? `${treePath}/${e.name}` : e.name,
  }));
  return {
    name: treePath ? treePath.split("/").at(-1) ?? treePath : ".",
    type: "directory",
    path: treePath || ".",
    children,
  };
}

/**
 * Fetch file content. ooc-3 uses /api/file/read endpoint.
 */
export function fetchFile(path: string) {
  return requestJson<FileContent>(`${endpoints.readAnyFile}${qs({ path })}`);
}

export function fetchAnyFile(path: string, maxBytes?: number) {
  return requestJson<AnyFileContent>(
    `${endpoints.readAnyFile}${qs({ path, maxBytes: maxBytes !== undefined ? String(maxBytes) : undefined })}`,
  );
}
