/**
 * 行为树数据结构 (G9)
 *
 * 行为树是 Flow 的结构化计划与执行机制。
 * Flow 可以一次性创建庞大的行为树，然后逐步执行。
 *
 * @ref docs/哲学文档/gene.md#G9 — implements — 行为树节点 CRUD（createProcess, addNode, removeNode, editNode）
 * @ref docs/哲学文档/gene.md#G10 — implements — appendAction 将事件挂载到节点
 * @ref src/types/process.ts — references — Process, ProcessNode, TodoItem 类型
 */

import type { Process, ProcessNode, NodeStatus, Action, TodoItem, FrameHook, HookTime, HookType } from "../types/index.js";

/** 生成唯一节点 ID */
let _nodeCounter = 0;
function generateNodeId(): string {
  return `node_${++_nodeCounter}_${Date.now().toString(36)}`;
}

/** 生成唯一 Hook ID */
function generateHookId(): string {
  return `hook_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 重置计数器（测试用） */
export function resetNodeCounter(): void {
  _nodeCounter = 0;
}

/**
 * 创建新的行为树（单根节点）
 *
 * @param title - 根节点标题（通常是任务描述）
 * @param description - 根节点详细说明
 * @returns 新的 Process
 */
export function createProcess(title: string, description?: string): Process {
  const rootId = generateNodeId();

  /* 创建初始 hooks（与 addNode 保持一致） */
  const initialHooks: FrameHook[] = [
    { id: generateHookId(), when: "when_stack_pop", type: "inject_message", handler: "summary" },
    { id: generateHookId(), when: "when_yield", type: "inject_message", handler: "summary" },
    { id: generateHookId(), when: "when_yield", type: "inject_message", handler: "declare_running_processes" },
  ];

  return {
    root: {
      id: rootId,
      title,
      ...(description ? { description } : {}),
      status: "doing",
      children: [],
      actions: [],
      hooks: initialHooks,
    },
    focusId: rootId,
  };
}

/**
 * 在指定父节点下添加子节点
 *
 * @param process - 行为树
 * @param parentId - 父节点 ID
 * @param title - 子节点标题
 * @param deps - 依赖的节点 ID 列表
 * @param description - 节点详细说明
 * @param traits - 静态声明的 traits（认知栈：栈帧携带的思维）
 * @returns 新节点的 ID，若父节点不存在返回 null
 */
export function addNode(
  process: Process,
  parentId: string,
  title: string,
  deps?: string[],
  description?: string,
  traits?: string[],
): string | null {
  const parent = findNode(process.root, parentId);
  if (!parent) return null;

  /* 检查深度限制（最大 20 层） */
  const depth = getNodeDepth(process.root, parentId);
  if (depth >= 20) return null;

  /* 创建初始 hooks */
  const initialHooks: FrameHook[] = [
    { id: generateHookId(), when: "when_stack_pop", type: "inject_message", handler: "summary" },
    { id: generateHookId(), when: "when_yield", type: "inject_message", handler: "summary" },
    { id: generateHookId(), when: "when_yield", type: "inject_message", handler: "declare_running_processes" },
  ];

  const newNode: ProcessNode = {
    id: generateNodeId(),
    title,
    ...(description ? { description } : {}),
    status: "todo",
    children: [],
    actions: [],
    deps: deps && deps.length > 0 ? deps : undefined,
    ...(traits && traits.length > 0 ? { traits } : {}),
    hooks: initialHooks,
  };

  parent.children.push(newNode);
  return newNode.id;
}

/**
 * 标记节点完成
 *
 * @param process - 行为树
 * @param nodeId - 节点 ID
 * @param summary - 完成摘要
 * @returns 是否成功
 */
export function completeNode(process: Process, nodeId: string, summary: string): boolean {
  const node = findNode(process.root, nodeId);
  if (!node) return false;

  node.status = "done";
  node.summary = summary;
  return true;
}

/**
 * 更新节点状态
 */
export function setNodeStatus(process: Process, nodeId: string, status: NodeStatus): boolean {
  const node = findNode(process.root, nodeId);
  if (!node) return false;
  node.status = status;
  return true;
}

/**
 * 向节点追加 Action
 */
export function appendAction(process: Process, nodeId: string, action: Action): boolean {
  const node = findNode(process.root, nodeId);
  if (!node) return false;
  node.actions.push(action);
  return true;
}

/**
 * 压缩指定 actions 到新子节点
 *
 * 将指定的 actions 从父节点移动到新创建的子节点中，生成摘要并标记为完成。
 * 归档节点不需要 hooks。
 *
 * @param process - 行为树
 * @param nodeId - 父节点 ID
 * @param actionIds - 要压缩的 action ID 列表
 * @returns 新创建的子节点 ID，若失败返回 null
 */
export function compressActions(
  process: Process,
  nodeId: string,
  actionIds: string[],
): string | null {
  const node = findNode(process.root, nodeId);
  if (!node) return null;

  /* 验证所有 actionIds 都存在 */
  const actionMap = new Map(node.actions.map(a => [a.id, a]));
  const toMove: Action[] = [];
  for (const id of actionIds) {
    const action = actionMap.get(id);
    if (!action) return null;
    toMove.push(action);
  }

  /* 生成子节点标题（取前 2 个 action 的内容摘要） */
  const brief = toMove.slice(0, 2).map(a => a.content.slice(0, 20)).join(", ");
  const childId = addNode(process, nodeId, `[compressed] ${brief}`);
  if (!childId) return null;

  const child = findNode(process.root, childId)!;

  /* 移动 actions 到子节点 */
  child.actions = toMove;
  child.hooks = []; // 归档节点不需要 hooks
  node.actions = node.actions.filter(a => !actionIds.includes(a.id!));

  /* 生成摘要（取前 3 个 action 的内容） */
  const summaryParts = toMove.slice(0, 3).map(a => {
    if (a.type === "thought") return a.content.slice(0, 40);
    if (a.type === "program") return a.success ? "程序成功" : "程序失败";
    return a.type;
  });
  child.summary = summaryParts.join("; ").slice(0, 120);
  child.status = "done";

  return childId;
}

/**
 * 收集行为树中所有节点的 actions，按时间戳排序
 *
 * 用于需要扁平时间线的场景（API 响应、前端展示等）。
 * 时间戳相同时，保持先序遍历中的原始顺序（稳定排序）。
 */
export function collectAllActions(root: ProcessNode): Action[] {
  const all: (Action & { _index: number })[] = [];
  let index = 0;
  const walk = (node: ProcessNode) => {
    for (const action of node.actions) {
      all.push({ ...action, _index: index++ });
    }
    for (const child of node.children) walk(child);
  };
  walk(root);
  all.sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    // 时间戳相同时，按先序遍历中的原始顺序排列
    return a._index - b._index;
  });
  return all as Action[];
}

/**
 * 在行为树中查找节点
 */
export function findNode(root: ProcessNode, id: string): ProcessNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * 获取节点深度
 */
function getNodeDepth(root: ProcessNode, targetId: string, depth: number = 0): number {
  if (root.id === targetId) return depth;
  for (const child of root.children) {
    const d = getNodeDepth(child, targetId, depth + 1);
    if (d >= 0) return d;
  }
  return -1;
}

/**
 * 获取从根到指定节点的路径
 */
export function getPathToNode(root: ProcessNode, targetId: string): ProcessNode[] {
  if (root.id === targetId) return [root];

  for (const child of root.children) {
    const path = getPathToNode(child, targetId);
    if (path.length > 0) {
      return [root, ...path];
    }
  }

  return [];
}

/**
 * 获取节点的父节点
 */
export function getParentNode(root: ProcessNode, targetId: string): ProcessNode | null {
  for (const child of root.children) {
    if (child.id === targetId) return root;
    const parent = getParentNode(child, targetId);
    if (parent) return parent;
  }
  return null;
}

/**
 * 删除节点（只能删除 todo 状态的节点）
 *
 * @param process - 行为树
 * @param nodeId - 要删除的节点 ID
 * @returns 是否成功
 */
export function removeNode(process: Process, nodeId: string): boolean {
  const node = findNode(process.root, nodeId);
  if (!node) return false;

  /* 不能删除根节点 */
  if (nodeId === process.root.id) return false;

  /* 只能删除 todo 状态的节点 */
  if (node.status !== "todo") return false;

  /* 不能删除当前 focus 节点 */
  if (nodeId === process.focusId) return false;

  const parent = getParentNode(process.root, nodeId);
  if (!parent) return false;

  parent.children = parent.children.filter((c) => c.id !== nodeId);

  /* 清理其他节点对该节点的依赖引用 */
  clearDepsReference(process.root, nodeId);

  return true;
}

/**
 * 修改节点标题
 *
 * @param process - 行为树
 * @param nodeId - 节点 ID
 * @param title - 新标题
 * @returns 是否成功
 */
export function editNode(process: Process, nodeId: string, title: string): boolean {
  const node = findNode(process.root, nodeId);
  if (!node) return false;

  /* 只能修改 todo 或 doing 状态的节点 */
  if (node.status === "done") return false;

  node.title = title;
  return true;
}

/**
 * 递归清理所有节点中对指定 ID 的依赖引用
 */
function clearDepsReference(node: ProcessNode, removedId: string): void {
  if (node.deps) {
    node.deps = node.deps.filter((d) => d !== removedId);
    if (node.deps.length === 0) delete node.deps;
  }
  for (const child of node.children) {
    clearDepsReference(child, removedId);
  }
}

/* ========== TodoList 管理 ========== */

/**
 * 确保 process.todo 已初始化
 */
function ensureTodo(process: Process): TodoItem[] {
  if (!process.todo) process.todo = [];
  return process.todo;
}

/**
 * 向 todolist 尾部追加一项
 */
export function addTodo(
  process: Process,
  nodeId: string,
  title: string,
  source: TodoItem["source"] = "manual",
): void {
  ensureTodo(process).push({ nodeId, title, source });
}

/**
 * 在 todolist 指定位置插入一项
 */
export function insertTodo(
  process: Process,
  index: number,
  nodeId: string,
  title: string,
  source: TodoItem["source"] = "manual",
): void {
  const todo = ensureTodo(process);
  const i = Math.max(0, Math.min(index, todo.length));
  todo.splice(i, 0, { nodeId, title, source });
}

/**
 * 移除 todolist 指定位置的项
 */
export function removeTodo(process: Process, index: number): boolean {
  const todo = ensureTodo(process);
  if (index < 0 || index >= todo.length) return false;
  todo.splice(index, 1);
  return true;
}

/**
 * 获取当前 todolist（只读副本）
 */
export function getTodo(process: Process): TodoItem[] {
  return [...(process.todo ?? [])];
}

/**
 * 弹出 todolist 头部（完成当前项）
 *
 * @returns 下一项的 nodeId，若队列为空返回 null
 */
export function popTodo(process: Process): string | null {
  const todo = ensureTodo(process);
  if (todo.length > 0) todo.shift();
  return todo.length > 0 ? todo[0]!.nodeId : null;
}

/**
 * 为收到的消息创建中断节点并插入 todolist 头部
 *
 * 1. 在根节点下创建一个消息处理子节点
 * 2. 在 todolist 头部插入 interrupt 项
 * 3. 返回新节点 ID（调用方负责 moveFocus）
 *
 * @param process - 行为树
 * @param from - 消息发送者
 * @param content - 消息内容摘要（用于节点标题）
 * @returns 新创建的中断节点 ID
 */
export function interruptForMessage(
  process: Process,
  from: string,
  content: string,
): string {
  const brief = content.length > 30 ? content.slice(0, 30) + "..." : content;
  const title = `处理来自 ${from} 的消息: ${brief}`;

  /* 在根节点下创建消息处理节点 */
  const nodeId = addNode(process, process.root.id, title)!;

  /* 在 todolist 头部插入中断项 */
  insertTodo(process, 0, nodeId, title, "interrupt");

  return nodeId;
}

/**
 * 在指定节点注册运行时 hook
 *
 * @param process - 行为树
 * @param nodeId - 节点 ID
 * @param when - 触发时机
 * @param type - Hook 类型
 * @param handler - 处理器描述文本
 * @returns 是否成功
 */
export function createFrameHook(
  process: Process,
  nodeId: string,
  when: HookTime,
  type: HookType,
  handler: string,
): boolean {
  const node = findNode(process.root, nodeId);
  if (!node) return false;
  if (!node.hooks) node.hooks = [];
  node.hooks.push({ id: generateHookId(), when, type, handler });
  return true;
}
