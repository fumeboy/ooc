import { TODO_async } from "../../transport/todo";
import type { AnyFileContent, FileContent, FileTreeNode, TreeScope } from "./model";

/**
 * 拉取一个目录树切片(scope=stones/pools/flows 等)。
 *
 * 用于左侧 Sidebar tree-scope 浏览器。path 缺省从 scope 根开始;path 给出时返
 * 回该子目录树。
 */
export function fetchTree(scope: TreeScope, path?: string) {
  return TODO_async<FileTreeNode>(
    `拉取 tree(scope=${scope}, path=${path ?? "(root)"});返回 FileTreeNode 树状结构(目录+文件名/类型),用于 Sidebar 浏览;暂未决定整树 vs 懒加载,初版可走整树返回`,
  );
}

/**
 * 读 world 内某文件内容(受 world baseDir 隔离)。
 *
 * 用于 FileViewer 显示 stones/pools/flows 下的源文件或运行时产物。
 */
export function fetchFile(path: string) {
  return TODO_async<FileContent>(
    `读 world 内文件(path=${path});受 baseDir 隔离;返回 FileContent { path, text, mime, etag? }; FileViewer 显示用`,
  );
}

/**
 * 读取任意本机文件(LLM file_window 视角),可选 maxBytes 软上限。
 *
 * 不受 world baseDir 隔离,服务 thread.contextWindows 中 file_window 类型窗口
 * 的内容预览。**有意绕过 baseDir;部署需配 path 白名单。**
 */
export function fetchAnyFile(path: string, maxBytes?: number) {
  return TODO_async<AnyFileContent>(
    `读任意本机文件 LLM 视角(path=${path}, maxBytes=${maxBytes ?? "(none)"});不受 baseDir 隔离; file_window 预览用; 部署需 path 白名单/鉴权; 返回 AnyFileContent`,
  );
}
