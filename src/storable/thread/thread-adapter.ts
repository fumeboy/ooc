/**
 * 线程树 → Process 转换适配器
 *
 * 将线程树架构的数据（threads.json + threads/{id}/thread.json）
 * 转换为前端 ProcessView 已支持的 Process 结构。
 *
 * @ref kernel/src/thinkable/thread-tree/types.ts — references — ThreadsTreeFile, ThreadsTreeNodeMeta
 * @ref kernel/src/shared/types/process.ts — references — Process, ProcessNode
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Process, ProcessNode, NodeStatus, Action } from "../../shared/types/index.js";
import type { ThreadsTreeFile, ThreadsTreeNodeMeta, ProcessEvent, ThreadDataFile } from "../../thinkable/thread-tree/types.js";

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

/** ProcessEvent → 前端 Action（字段兼容，直接透传）
 *
 * 重要：必须透传所有字段，前端会用到：
 * - name/args/title：TuiAction 渲染 tool_use 卡片
 * - form：message_out 带结构化表单时，前端渲染 option picker
 * - formResponse：message_in 回显用户结构化回复
 * - context：do/talk 的 fork/continue 模式徽章
 * 历史上曾因遗漏 form 字段导致前端 Talk Form picker 完全失效
 * （Bruce 首轮体验 2026-04-22 #7）。
 */
function mapAction(a: ProcessEvent): Action {
  return {
    id: a.id,
    type: a.type as Action["type"],
    timestamp: a.timestamp,
    content: a.content,
    name: a.name,
    args: a.args,
    title: a.title,
    result: a.result,
    success: a.success,
    form: a.form,
    formResponse: a.formResponse,
    context: a.context,
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

  /* 读取该线程的 process events、pins 和 pause 状态 */
  let events: Action[] = [];
  let pins: string[] = [];
  let hasPendingOutput = false;
  const threadJsonPath = join(threadsDir, nodeId, "thread.json");
  if (existsSync(threadJsonPath)) {
    try {
      const threadData = JSON.parse(readFileSync(threadJsonPath, "utf-8")) as ThreadDataFile;
      events = (threadData.events ?? []).map(mapAction);
      pins = threadData.pins ?? [];
      hasPendingOutput = !!threadData._pendingOutput;
    } catch { /* 解析失败则无 events */ }
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
    events,
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
