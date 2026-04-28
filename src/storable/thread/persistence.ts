/**
 * 线程树持久化层
 *
 * 负责 threads.json（树索引）和 thread.json（线程数据）的读写。
 *
 * 写入规则：
 * - thread.json：线程独占写入（无冲突）
 * - threads.json：通过外部串行化队列写入（本模块不负责并发控制）
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#10
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ThreadsTreeFile, ThreadDataFile } from "../../thinkable/thread-tree/types.js";

const THREADS_TREE_FILENAME = "threads.json";
const THREAD_DATA_FILENAME = "thread.json";
const THREADS_DIR = "threads";

/* ========== threads.json 读写 ========== */

/**
 * 读取线程树索引
 * @param objectFlowDir - Object 的 Flow 目录（如 flows/{sessionId}/objects/{name}/）
 * @returns ThreadsTreeFile 或 null（不存在时）
 */
export function readThreadsTree(objectFlowDir: string): ThreadsTreeFile | null {
  const filePath = join(objectFlowDir, THREADS_TREE_FILENAME);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ThreadsTreeFile;
  } catch {
    return null;
  }
}

/**
 * 写入线程树索引
 * @param objectFlowDir - Object 的 Flow 目录
 * @param tree - 线程树数据
 */
export function writeThreadsTree(objectFlowDir: string, tree: ThreadsTreeFile): void {
  mkdirSync(objectFlowDir, { recursive: true });
  const filePath = join(objectFlowDir, THREADS_TREE_FILENAME);
  writeFileSync(filePath, JSON.stringify(tree, null, 2), "utf-8");
}

/* ========== thread.json 读写 ========== */

/**
 * 读取单个线程的运行时数据
 * @param threadDir - 线程目录（如 threads/{rootId}/{childId}/）
 * @returns ThreadDataFile 或 null（不存在时）
 */
export function readThreadData(threadDir: string): ThreadDataFile | null {
  const filePath = join(threadDir, THREAD_DATA_FILENAME);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const { actions: _legacyActions, ...data } = JSON.parse(raw) as ThreadDataFile & Record<string, unknown>;
    return {
      ...data,
      events: Array.isArray(data.events) ? data.events : [],
    } as ThreadDataFile;
  } catch {
    return null;
  }
}

/**
 * 写入单个线程的运行时数据
 * @param threadDir - 线程目录
 * @param data - 线程数据
 */
export function writeThreadData(threadDir: string, data: ThreadDataFile): void {
  mkdirSync(threadDir, { recursive: true });
  const filePath = join(threadDir, THREAD_DATA_FILENAME);
  const { actions: _legacyActions, ...persisted } = data as ThreadDataFile & Record<string, unknown>;
  writeFileSync(filePath, JSON.stringify(persisted, null, 2), "utf-8");
}

/* ========== 目录路径计算 ========== */

/**
 * 计算线程的目录路径（目录嵌套 = 父子关系）
 * @param objectFlowDir - Object 的 Flow 目录
 * @param ancestorPath - 从 Root 到目标节点的 ID 路径（如 ["root", "child_a", "grandchild_x"]）
 * @returns 线程目录的绝对路径
 */
export function getThreadDir(objectFlowDir: string, ancestorPath: string[]): string {
  return join(objectFlowDir, THREADS_DIR, ...ancestorPath);
}

/**
 * 确保线程目录存在（递归创建）
 * @param objectFlowDir - Object 的 Flow 目录
 * @param ancestorPath - 从 Root 到目标节点的 ID 路径
 * @returns 线程目录的绝对路径
 */
export function ensureThreadDir(objectFlowDir: string, ancestorPath: string[]): string {
  const dir = getThreadDir(objectFlowDir, ancestorPath);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 根据 threads.json 计算某个节点的祖先路径
 * @param tree - 线程树索引
 * @param nodeId - 目标节点 ID
 * @returns 从 Root 到目标节点的 ID 数组，如 ["root", "a", "b"]
 */
export function getAncestorPath(tree: ThreadsTreeFile, nodeId: string): string[] {
  const path: string[] = [];
  let current = nodeId;
  while (current) {
    path.unshift(current);
    const node = tree.nodes[current];
    if (!node || !node.parentId) break;
    current = node.parentId;
  }
  return path;
}
