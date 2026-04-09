/**
 * 线程树 → Process 转换适配器
 *
 * 将线程树架构的数据（threads.json + threads/{id}/thread.json）
 * 转换为前端 ProcessView 已支持的 Process 结构。
 *
 * @ref kernel/src/thread/types.ts — references — ThreadsTreeFile, ThreadsTreeNodeMeta
 * @ref kernel/src/types/process.ts — references — Process, ProcessNode
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Process, ProcessNode, NodeStatus, Action } from "../types/index.js";
import type { ThreadsTreeFile, ThreadsTreeNodeMeta, ThreadAction } from "../thread/types.js";

/** 线程状态 → 行为树节点状态 */
function mapStatus(status: ThreadsTreeNodeMeta["status"]): NodeStatus {
  switch (status) {
    case "running": return "doing";
    case "waiting": return "doing";
    case "done": return "done";
    case "failed": return "done";
    case "pending": return "todo";
    default: return "todo";
  }
}

/** ThreadAction → Action（字段兼容，直接透传） */
function mapAction(a: ThreadAction): Action {
  return {
    id: a.id,
    type: a.type as Action["type"],
    timestamp: a.timestamp,
    content: a.content,
    result: a.result,
    success: a.success,
  };
}

/**
 * 递归构建 ProcessNode 树
 *
 * @param nodeId - 当前节点 ID
 * @param tree - 线程树索引
 * @param threadsDir - threads/ 目录路径
 */
function buildNode(
  nodeId: string,
  tree: ThreadsTreeFile,
  threadsDir: string,
): ProcessNode {
  const meta = tree.nodes[nodeId]!;

  /* 读取该线程的 actions、pins 和 pause 状态 */
  let actions: Action[] = [];
  let pins: string[] = [];
  let hasPendingOutput = false;
  const threadJsonPath = join(threadsDir, nodeId, "thread.json");
  if (existsSync(threadJsonPath)) {
    try {
      const threadData = JSON.parse(readFileSync(threadJsonPath, "utf-8"));
      actions = (threadData.actions ?? []).map(mapAction);
      pins = threadData.pins ?? [];
      hasPendingOutput = !!threadData._pendingOutput;
    } catch { /* 解析失败则无 actions */ }
  }

  /* 递归构建子节点 */
  const children = (meta.childrenIds ?? [])
    .filter((id) => tree.nodes[id])
    .map((id) => buildNode(id, tree, threadsDir));

  return {
    id: meta.id,
    title: meta.title,
    description: meta.description,
    status: mapStatus(meta.status),
    children,
    actions,
    traits: meta.traits,
    activatedTraits: meta.activatedTraits,
    outputs: meta.outputs,
    outputDescription: meta.outputDescription,
    summary: meta.summary,
    deps: [],
    /* 线程元数据：通过 locals 传递给前端 ThreadsTreeView */
    locals: {
      _threadStatus: meta.status,
      _creatorThreadId: meta.creatorThreadId ?? null,
      _creationMode: meta.creationMode ?? null,
      _awaitingChildren: meta.awaitingChildren ?? [],
      _createdAt: meta.createdAt,
      _updatedAt: meta.updatedAt,
      _pins: pins,
      _hasPendingOutput: hasPendingOutput,
    },
  };
}

/**
 * 将线程树数据转换为 Process 结构
 *
 * @param dir - Flow 对象目录（含 threads.json 和 threads/ 子目录）
 * @returns Process 结构，若无线程树数据返回 null
 */
export function threadsToProcess(dir: string): Process | null {
  const treePath = join(dir, "threads.json");
  if (!existsSync(treePath)) return null;

  let tree: ThreadsTreeFile;
  try {
    tree = JSON.parse(readFileSync(treePath, "utf-8"));
  } catch {
    return null;
  }

  if (!tree.rootId || !tree.nodes[tree.rootId]) return null;

  const threadsDir = join(dir, "threads");
  const root = buildNode(tree.rootId, tree, threadsDir);

  /* focusId：优先选 running 线程，其次选 root */
  let focusId = tree.rootId;
  for (const node of Object.values(tree.nodes)) {
    if (node.status === "running" || node.status === "waiting") {
      focusId = node.id;
      break;
    }
  }

  return { root, focusId, isThreadTree: true };
}
