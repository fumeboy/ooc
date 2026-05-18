import { endpoints } from "../../transport/endpoints";
import { qs, requestJson } from "../../transport/http";
import type { AnyFileContent, FileContent, FileTreeNode, TreeScope } from "./model";

export function fetchTree(scope: TreeScope, path?: string) {
  return requestJson<FileTreeNode>(`${endpoints.tree}${qs({ scope, path })}`);
}

export function fetchFile(path: string) {
  return requestJson<FileContent>(`${endpoints.file}${qs({ path })}`);
}

/** 读取任意本机文件(LLM file_window 视角),可选 maxBytes 软上限。 */
export function fetchAnyFile(path: string, maxBytes?: number) {
  return requestJson<AnyFileContent>(
    `${endpoints.readAnyFile}${qs({ path, maxBytes: maxBytes !== undefined ? String(maxBytes) : undefined })}`,
  );
}

