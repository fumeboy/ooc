import { endpoints } from "../../transport/endpoints";
import { qs, requestJson } from "../../transport/http";
import type { FileContent, FileTreeNode, TreeScope } from "./model";

export function fetchTree(scope: TreeScope, path?: string) {
  return requestJson<FileTreeNode>(`${endpoints.tree}${qs({ scope, path })}`);
}

export function fetchFile(path: string) {
  return requestJson<FileContent>(`${endpoints.file}${qs({ path })}`);
}

