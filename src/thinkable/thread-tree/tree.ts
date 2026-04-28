/**
 * ThreadsTree — 线程树内存模型
 *
 * 管理整棵线程树的内存状态，提供所有 CRUD 操作。
 * 每个 Object 在 Flow 中持有一个 ThreadsTree 实例。
 *
 * 读写规则：
 * - 读：直接读内存（无 IO），始终是最新状态
 * - 写：通过 WriteQueue 串行执行，每次写入后 flush 到 threads.json
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#2
 */

import type {
  ThreadsTreeFile,
  ThreadsTreeNodeMeta,
  ThreadDataFile,
  ThreadStatus,
  ThreadHandle,
  ThreadResult,
  ProcessEvent,
  ThreadInboxMessage,
  ThreadTodoItem,
  ThreadFrameHook,
} from "./types.js";
import {
  readThreadsTree,
  writeThreadsTree,
  readThreadData,
  writeThreadData,
  getThreadDir,
  ensureThreadDir,
  getAncestorPath,
} from "../../storable/thread/persistence.js";
import { WriteQueue } from "../../storable/thread/queue.js";

/** 生成唯一节点 ID */
function generateNodeId(): string {
  return `th_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 最大树深度（G9 约束） */
const MAX_DEPTH = 20;

export class ThreadsTree {
  /** Object 的 Flow 目录 */
  private readonly _dir: string;
  /** 内存中的树索引 */
  private _tree: ThreadsTreeFile;
  /** 串行化写入队列 */
  private readonly _writeQueue = new WriteQueue();
  /** 线程复活回调（writeInbox 触发 done → running 时调用） */
  private _onRevival?: (nodeId: string) => void;

  private constructor(dir: string, tree: ThreadsTreeFile) {
    this._dir = dir;
    this._tree = tree;
  }

  /* ========== 静态工厂方法 ========== */

  /**
   * 创建新的线程树（含 Root 节点）
   *
   * @param objectFlowDir - Object 的 Flow 目录
   * @param title - Root 节点标题
   * @param description - Root 节点描述
   * @returns ThreadsTree 实例
   */
  static async create(
    objectFlowDir: string,
    title: string,
    description?: string,
  ): Promise<ThreadsTree> {
    const rootId = generateNodeId();
    const now = Date.now();

    const rootMeta: ThreadsTreeNodeMeta = {
      id: rootId,
      title,
      description,
      status: "running",
      childrenIds: [],
      createdAt: now,
      updatedAt: now,
    };

    const tree: ThreadsTreeFile = {
      rootId,
      nodes: { [rootId]: rootMeta },
    };

    /* 写入 threads.json */
    writeThreadsTree(objectFlowDir, tree);

    /* 创建 Root 的 thread.json */
    const rootThreadDir = ensureThreadDir(objectFlowDir, [rootId]);
    const rootData: ThreadDataFile = {
      id: rootId,
      events: [],
    };
    writeThreadData(rootThreadDir, rootData);

    return new ThreadsTree(objectFlowDir, tree);
  }

  /**
   * 从磁盘加载已有线程树
   *
   * @param objectFlowDir - Object 的 Flow 目录
   * @returns ThreadsTree 实例，不存在时返回 null
   */
  static load(objectFlowDir: string): ThreadsTree | null {
    const tree = readThreadsTree(objectFlowDir);
    if (!tree) return null;
    return new ThreadsTree(objectFlowDir, tree);
  }

  /* ========== 只读属性 ========== */

  /** Root 节点 ID */
  get rootId(): string {
    return this._tree.rootId;
  }

  /**
   * 返回当前线程树的 ThreadsTreeFile 只读快照
   *
   * 用途：外部工具（如 context-builder 的 computeThreadScopeChain）需要直接
   * 按快照语义遍历节点，而非通过 ThreadsTree 的高层方法。注意返回的是
   * **浅引用**——调用方不应修改其内部结构，所有变更必须走 ThreadsTree 的
   * _mutate 写队列，否则会绕过序列化并破坏磁盘一致性。
   */
  toFile(): ThreadsTreeFile {
    return this._tree;
  }

  /** 获取所有节点 ID */
  get nodeIds(): string[] {
    return Object.keys(this._tree.nodes);
  }

  /** 获取节点元数据（浅拷贝，不暴露活引用） */
  getNode(nodeId: string): ThreadsTreeNodeMeta | null {
    const node = this._tree.nodes[nodeId];
    if (!node) return null;
    return { ...node };
  }

  /** 获取节点的子节点列表（浅拷贝） */
  getChildren(nodeId: string): ThreadsTreeNodeMeta[] {
    const node = this._tree.nodes[nodeId];
    if (!node) return [];
    return node.childrenIds
      .map(id => this._tree.nodes[id])
      .filter((n): n is ThreadsTreeNodeMeta => n != null)
      .map(n => ({ ...n }));
  }

  /** 获取从 Root 到指定节点的祖先路径 */
  getAncestorPath(nodeId: string): string[] {
    return getAncestorPath(this._tree, nodeId);
  }

  /** 计算节点深度（Root = 0） */
  getDepth(nodeId: string): number {
    return this.getAncestorPath(nodeId).length - 1;
  }

  /**
   * 计算 scope chain（从 Root 到指定节点路径上所有 traits 合并）
   *
   * @param nodeId - 目标节点 ID
   * @returns 去重后的 trait 名称列表
   */
  computeScopeChain(nodeId: string): string[] {
    const path = this.getAncestorPath(nodeId);
    const seen = new Set<string>();
    for (const id of path) {
      const node = this._tree.nodes[id];
      if (!node) continue;
      if (node.traits) {
        for (const t of node.traits) seen.add(t);
      }
      if (node.activatedTraits) {
        for (const t of node.activatedTraits) seen.add(t);
      }
    }
    return Array.from(seen);
  }

  /** 读取指定线程的运行时数据（thread.json） */
  readThreadData(nodeId: string): ThreadDataFile | null {
    const path = this.getAncestorPath(nodeId);
    const dir = getThreadDir(this._dir, path);
    return readThreadData(dir);
  }

  /** 写入指定线程的运行时数据（thread.json，线程独占，无需队列） */
  writeThreadData(nodeId: string, data: ThreadDataFile): void {
    const path = this.getAncestorPath(nodeId);
    const dir = ensureThreadDir(this._dir, path);
    writeThreadData(dir, data);
  }

  /* ========== 线程管理 ========== */

  /**
   * 创建子线程
   *
   * 在指定父节点下创建子节点，初始状态为 pending。
   * 同时创建子线程的 thread.json（空 events）。
   *
   * @param parentId - 父节点 ID
   * @param title - 子线程标题
   * @param options - 可选参数（traits, description, outputs, outputDescription）
   * @returns 子线程 ID（ThreadHandle），父节点不存在或超深度时返回 null
   */
  async createSubThread(
    parentId: string,
    title: string,
    options?: {
      traits?: string[];
      description?: string;
      outputs?: string[];
      outputDescription?: string;
      creatorThreadId?: string;
      creatorObjectName?: string;
      // 阶段 5 新增（协作 API 所需）
      linkedWaitingNodeId?: string;
      linkedWaitingObjectName?: string;
      creationMode?: "sub_thread" | "sub_thread_on_node" | "talk";
    },
  ): Promise<ThreadHandle | null> {
    const parent = this._tree.nodes[parentId];
    if (!parent) return null;

    /* 检查深度限制 */
    const depth = this.getDepth(parentId);
    if (depth >= MAX_DEPTH - 1) return null;

    const childId = generateNodeId();
    const now = Date.now();

    const childMeta: ThreadsTreeNodeMeta = {
      id: childId,
      title,
      description: options?.description,
      status: "pending",
      parentId,
      childrenIds: [],
      traits: options?.traits,
      outputs: options?.outputs,
      outputDescription: options?.outputDescription,
      creatorThreadId: options?.creatorThreadId ?? parentId,
      creatorObjectName: options?.creatorObjectName,
      linkedWaitingNodeId: options?.linkedWaitingNodeId,
      linkedWaitingObjectName: options?.linkedWaitingObjectName,
      creationMode: options?.creationMode,
      createdAt: now,
      updatedAt: now,
    };

    /* 串行化写入树索引 */
    await this._mutate((tree) => {
      tree.nodes[childId] = childMeta;
      tree.nodes[parentId]!.childrenIds.push(childId);
      tree.nodes[parentId]!.updatedAt = now;
    });

    /* 创建子线程的 thread.json（独占写入，无需队列） */
    const ancestorPath = this.getAncestorPath(childId);
    const threadDir = ensureThreadDir(this._dir, ancestorPath);
    const threadData: ThreadDataFile = {
      id: childId,
      events: [],
    };
    writeThreadData(threadDir, threadData);

    return childId;
  }

  /**
   * 更新节点状态
   *
   * 当 status === "waiting" 时，可通过 waitingType 标识具体等待原因：
   * - "await_children": 等子线程完成
   * - "talk_sync": 等其他对象同步回复
   * - "explicit_wait": LLM 主动 wait 暂停
   *
   * 当 status 不是 "waiting" 时，会自动清除 waitingType 字段。
   *
   * @param nodeId - 节点 ID
   * @param status - 新状态
   * @param waitingType - 等待类型（仅 status === "waiting" 时有意义）
   */
  async setNodeStatus(
    nodeId: string,
    status: ThreadStatus,
    waitingType?: ThreadsTreeNodeMeta["waitingType"]
  ): Promise<void> {
    if (!this._tree.nodes[nodeId]) return;
    await this._mutate((tree) => {
      const node = tree.nodes[nodeId];
      if (node) {
        node.status = status;
        if (status === "waiting" && waitingType) {
          node.waitingType = waitingType;
        } else {
          node.waitingType = undefined;
        }
        node.updatedAt = Date.now();
      }
    });
  }

  /**
   * 更新节点元数据（通用字段更新）
   *
   * 用于协作 API 中需要更新 summary 等非状态字段的场景。
   * 与 setNodeStatus 不同，此方法可更新任意 meta 字段。
   *
   * @param nodeId - 节点 ID
   * @param fields - 要更新的字段（部分更新）
   */
  async updateNodeMeta(nodeId: string, fields: Partial<Pick<ThreadsTreeNodeMeta,
    "summary" | "description" | "awaitingChildren" | "linkedWaitingNodeId" | "linkedWaitingObjectName"
  >>): Promise<void> {
    if (!this._tree.nodes[nodeId]) return;
    await this._mutate((tree) => {
      const node = tree.nodes[nodeId];
      if (node) {
        Object.assign(node, fields);
        node.updatedAt = Date.now();
      }
    });
  }

  /**
   * 完成线程（return）
   *
   * 1. 设置节点 status = "done"，写入 summary
   * 2. 将 artifacts 合并到创建者线程的 locals
   * 3. 将 summary 写入创建者线程的 inbox（source: "system"）
   *
   * @param nodeId - 要完成的节点 ID
   * @param summary - 完成摘要
   * @param artifacts - 产出数据（合并到创建者的 locals）
   */
  async returnThread(
    nodeId: string,
    summary: string,
    artifacts?: Record<string, unknown>,
  ): Promise<void> {
    if (!this._tree.nodes[nodeId]) return;

    /* 1. 更新节点状态和摘要 */
    await this._mutate((tree) => {
      const n = tree.nodes[nodeId];
      if (n) {
        n.status = "done";
        n.summary = summary;
        n.updatedAt = Date.now();
      }
    });

    /* 2. _mutate 完成后再读取最新数据（审查建议：不用预捕获引用） */
    const node = this._tree.nodes[nodeId];
    if (!node) return;

    const creatorId = node.creatorThreadId;
    const nodeTitle = node.title;

    if (creatorId && this._tree.nodes[creatorId]) {
      const creatorData = this.readThreadData(creatorId);
      if (creatorData) {
        /* 合并 artifacts 到 locals */
        if (artifacts) {
          creatorData.locals = { ...(creatorData.locals ?? {}), ...artifacts };
        }

        /* 写入 inbox 通知 */
        if (!creatorData.inbox) creatorData.inbox = [];
        creatorData.inbox.push({
          id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          from: nodeTitle,
          content: `子线程「${nodeTitle}」已完成: ${summary}`,
          timestamp: Date.now(),
          source: "system",
          status: "unread",
        });

        this.writeThreadData(creatorId, creatorData);
      }
    }
  }

  /* ========== 等待与唤醒 ========== */

  /**
   * 等待子线程（由 do(wait=true) 等上层指令触发）
   *
   * 设置当前节点的 awaitingChildren，状态变为 waiting。
   * 不是 JS 层面的 await，而是线程状态转换。
   * Scheduler 检测到 status !== "running" 后退出该线程的循环。
   *
   * @param nodeId - 当前节点 ID（等待者）
   * @param childIds - 要等待的子线程 ID 列表
   */
  async awaitThreads(nodeId: string, childIds: string[]): Promise<void> {
    if (!this._tree.nodes[nodeId]) return;
    await this._mutate((tree) => {
      const node = tree.nodes[nodeId];
      if (node) {
        node.awaitingChildren = childIds;
        node.status = "waiting";
        node.waitingType = "await_children";
        node.updatedAt = Date.now();
      }
    });
  }

  /**
   * 检查等待条件是否满足，满足则唤醒
   *
   * 如果 awaitingChildren 中的所有子线程都已 done 或 failed，
   * 则清除 awaitingChildren，状态变为 running。
   *
   * @param nodeId - 等待中的节点 ID
   * @returns 是否被唤醒
   */
  async checkAndWake(nodeId: string): Promise<boolean> {
    const node = this._tree.nodes[nodeId];
    if (!node || node.status !== "waiting" || !node.awaitingChildren) return false;

    const allDone = node.awaitingChildren.every(childId => {
      const child = this._tree.nodes[childId];
      return child && (child.status === "done" || child.status === "failed");
    });

    if (!allDone) return false;

    await this._mutate((tree) => {
      const n = tree.nodes[nodeId];
      if (n) {
        n.awaitingChildren = undefined;
        n.status = "running";
        n.waitingType = undefined;
        n.updatedAt = Date.now();
      }
    });

    return true;
  }

  /**
   * 查找所有正在等待指定子线程的父节点
   *
   * Scheduler 在子线程完成时调用，找到需要检查唤醒的节点。
   *
   * @param childId - 已完成的子线程 ID
   * @returns 等待该子线程的节点 ID 列表
   */
  findWaitingParents(childId: string): string[] {
    const result: string[] = [];
    for (const node of Object.values(this._tree.nodes)) {
      if (
        node.status === "waiting" &&
        node.awaitingChildren &&
        node.awaitingChildren.includes(childId)
      ) {
        result.push(node.id);
      }
    }
    return result;
  }

  /* ========== 线程复活回调 ========== */

  /**
   * 注入线程复活回调
   *
   * Engine 初始化时调用，当 writeInbox 触发 done → running 时通知 Scheduler。
   *
   * @param cb - 回调函数，参数为被复活的线程 ID
   */
  setRevivalCallback(cb: (nodeId: string) => void): void {
    this._onRevival = cb;
  }

  /* ========== inbox 操作 ========== */

  /** unread 消息上限 */
  private static readonly INBOX_UNREAD_LIMIT = 50;
  /** marked 消息保留上限 */
  private static readonly INBOX_MARKED_LIMIT = 200;
  /** marked 消息清理后保留数量 */
  private static readonly INBOX_MARKED_KEEP = 100;

  /**
   * 向指定线程的 inbox 写入消息
   *
   * 自动处理溢出：unread 超过 50 条时自动 mark(ignore) 最早的消息。
   * marked 超过 200 条时自动清理最早的 marked 消息（保留最近 100 条）。
   *
   * @param nodeId - 目标线程 ID
   * @param msg - 消息内容（不含 id, timestamp, status）
   */
  writeInbox(
    nodeId: string,
    msg: {
      from: string;
      content: string;
      source: ThreadInboxMessage["source"];
      issueId?: string;
      /** 可选消息类型标签（Phase 6，如 "relation_update_request"） */
      kind?: string;
    },
  ): void {
    const data = this.readThreadData(nodeId);
    if (!data) return;

    if (!data.inbox) data.inbox = [];

    /* 写入新消息 */
    const newMsg: ThreadInboxMessage = {
      id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      from: msg.from,
      content: msg.content,
      timestamp: Date.now(),
      source: msg.source,
      issueId: msg.issueId,
      status: "unread",
      ...(msg.kind ? { kind: msg.kind } : {}),
    };
    data.inbox.push(newMsg);

    /* unread 溢出处理：超过上限时自动 mark(ignore) 最早的 unread */
    const unread = data.inbox.filter(m => m.status === "unread");
    if (unread.length > ThreadsTree.INBOX_UNREAD_LIMIT) {
      const overflow = unread.length - ThreadsTree.INBOX_UNREAD_LIMIT;
      let count = 0;
      for (const m of data.inbox) {
        if (m.status === "unread" && count < overflow) {
          m.status = "marked";
          m.mark = { type: "ignore", tip: "inbox 溢出", markedAt: Date.now() };
          count++;
        }
      }
    }

    /* marked 清理：超过上限时清理最早的 marked 消息 */
    const marked = data.inbox.filter(m => m.status === "marked");
    if (marked.length > ThreadsTree.INBOX_MARKED_LIMIT) {
      const markedIds = new Set(
        marked
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(0, marked.length - ThreadsTree.INBOX_MARKED_KEEP)
          .map(m => m.id)
      );
      data.inbox = data.inbox.filter(m => !(m.status === "marked" && markedIds.has(m.id)));
    }

    this.writeThreadData(nodeId, data);

    /* 线程复活：done 线程收到消息时自动唤醒为 running */
    const node = this._tree.nodes[nodeId];
    if (node && node.status === "done") {
      node.status = "running";
      node.revivalCount = (node.revivalCount ?? 0) + 1;
      node.updatedAt = Date.now();
      writeThreadsTree(this._dir, this._tree);
      this._onRevival?.(nodeId);
    }

    /* B2 fix（Option B）：waiting + waitingType=talk_sync → 唤醒
     *
     * talk_sync 调用者进入 waiting+waitingType=talk_sync 等待对方回复。
     * 当对方把消息写入本线程 inbox 时，视为回复到达，自动将线程转回 running。
     * 注意：
     * - 不调用 _onRevival —— talk_sync 唤醒不算 revival（线程本来就活着，没结束过）。
     * - 不递增 revivalCount —— revivalCount 语义专属于 done → running 的复活路径。
     * - 其他 waitingType（await_children、explicit_wait）不在此处处理，保持不变。
     *   await_children 由 checkAndWake 处理；explicit_wait 由显式 resume 处理。
     */
    if (node && node.status === "waiting" && node.waitingType === "talk_sync") {
      node.status = "running";
      node.waitingType = undefined;
      node.updatedAt = Date.now();
      writeThreadsTree(this._dir, this._tree);
    }
  }

  /**
   * 标记 inbox 消息
   *
   * @param nodeId - 线程 ID
   * @param messageId - 消息 ID
   * @param type - 标记类型（ack / ignore / todo）
   * @param tip - 标记说明
   */
  markInbox(
    nodeId: string,
    messageId: string,
    type: "ack" | "ignore" | "todo",
    tip: string,
  ): void {
    const data = this.readThreadData(nodeId);
    if (!data || !data.inbox) return;

    const msg = data.inbox.find(m => m.id === messageId);
    if (!msg) return;

    msg.status = "marked";
    msg.mark = { type, tip, markedAt: Date.now() };

    this.writeThreadData(nodeId, data);
  }

  /* ========== todo 操作 ========== */

  /**
   * 在指定线程创建待办
   *
   * @param nodeId - 线程 ID
   * @param content - 待办内容
   * @param sourceMessageId - 关联的 inbox 消息 ID（可选）
   */
  addTodo(nodeId: string, content: string, sourceMessageId?: string): void {
    const data = this.readThreadData(nodeId);
    if (!data) return;

    if (!data.todos) data.todos = [];

    const todo: ThreadTodoItem = {
      id: `todo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      content,
      sourceMessageId,
      status: "pending",
      createdAt: Date.now(),
    };
    data.todos.push(todo);

    this.writeThreadData(nodeId, data);
  }

  /**
   * 标记待办完成
   *
   * @param nodeId - 线程 ID
   * @param todoId - 待办 ID
   */
  completeTodo(nodeId: string, todoId: string): void {
    const data = this.readThreadData(nodeId);
    if (!data || !data.todos) return;

    const todo = data.todos.find(t => t.id === todoId);
    if (!todo) return;

    todo.status = "done";
    todo.doneAt = Date.now();

    this.writeThreadData(nodeId, data);
  }

  /**
   * 检查指定线程是否有未完成待办
   *
   * @param nodeId - 线程 ID
   * @returns 是否有 pending 状态的 todo
   */
  hasPendingTodos(nodeId: string): boolean {
    const data = this.readThreadData(nodeId);
    if (!data || !data.todos) return false;
    return data.todos.some(t => t.status === "pending");
  }

  /**
   * 获取指定线程的未完成待办列表
   *
   * @param nodeId - 线程 ID
   * @returns pending 状态的 todo 列表
   */
  getPendingTodos(nodeId: string): ThreadTodoItem[] {
    const data = this.readThreadData(nodeId);
    if (!data || !data.todos) return [];
    return data.todos.filter(t => t.status === "pending");
  }

  /* ========== Trait 激活（认知栈） ========== */

  /**
   * 动态激活 trait（写入 activatedTraits）
   *
   * 说明：
   * - 这是“运行时激活”，用于将某个 trait 加入当前节点（栈帧）的作用域链。
   * - 激活后会影响 computeScopeChain() 以及下次构建沙箱方法注入。
   *
   * @param nodeId - 线程 ID
   * @param traitId - trait 完整 ID（如 "lark/doc"）
   * @returns 是否发生了变更
   */
  async activateTrait(nodeId: string, traitId: string): Promise<boolean> {
    if (!this._tree.nodes[nodeId]) return false;
    let changed = false;
    await this._mutate((tree) => {
      const node = tree.nodes[nodeId];
      if (!node) return;
      if (!node.activatedTraits) node.activatedTraits = [];
      if (node.activatedTraits.includes(traitId)) return;
      node.activatedTraits.push(traitId);
      node.updatedAt = Date.now();
      changed = true;
    });
    return changed;
  }

  /**
   * 取消动态激活 trait（从 activatedTraits 移除）
   * @param nodeId - 线程 ID
   * @param traitId - trait 完整 ID
   * @returns 是否发生了变更
   */
  async deactivateTrait(nodeId: string, traitId: string): Promise<boolean> {
    if (!this._tree.nodes[nodeId]) return false;
    let changed = false;
    await this._mutate((tree) => {
      const node = tree.nodes[nodeId];
      if (!node?.activatedTraits || node.activatedTraits.length === 0) return;
      const before = node.activatedTraits.length;
      node.activatedTraits = node.activatedTraits.filter(t => t !== traitId);
      if (node.activatedTraits.length === before) return;
      /* 同步清理 pinnedTraits 里的同 id（deactivate 隐含 unpin） */
      if (node.pinnedTraits && node.pinnedTraits.includes(traitId)) {
        node.pinnedTraits = node.pinnedTraits.filter(t => t !== traitId);
      }
      node.updatedAt = Date.now();
      changed = true;
    });
    return changed;
  }

  /**
   * 固定 trait：把 trait 钉在作用域（submit/close 回收时豁免）
   * 调用方假设 traitId 已在 activatedTraits 里或同事务内先激活。幂等。
   * @returns 是否发生变更（false 表示本就已固定）
   */
  async pinTrait(nodeId: string, traitId: string): Promise<boolean> {
    if (!this._tree.nodes[nodeId]) return false;
    let changed = false;
    await this._mutate((tree) => {
      const node = tree.nodes[nodeId];
      if (!node) return;
      if (!node.pinnedTraits) node.pinnedTraits = [];
      if (node.pinnedTraits.includes(traitId)) return;
      node.pinnedTraits.push(traitId);
      node.updatedAt = Date.now();
      changed = true;
    });
    return changed;
  }

  /**
   * 解除固定：trait 仍在 activatedTraits 里，但不再享有回收豁免
   * @returns 是否发生变更（false 表示本就未固定）
   */
  async unpinTrait(nodeId: string, traitId: string): Promise<boolean> {
    if (!this._tree.nodes[nodeId]) return false;
    let changed = false;
    await this._mutate((tree) => {
      const node = tree.nodes[nodeId];
      if (!node?.pinnedTraits || !node.pinnedTraits.includes(traitId)) return;
      node.pinnedTraits = node.pinnedTraits.filter(t => t !== traitId);
      node.updatedAt = Date.now();
      changed = true;
    });
    return changed;
  }

  /** 查询 trait 是否已固定 */
  isPinnedTrait(nodeId: string, traitId: string): boolean {
    const node = this._tree.nodes[nodeId];
    return !!node?.pinnedTraits?.includes(traitId);
  }

  /* ========== 内部：串行化写入 ========== */

  /**
   * 串行化修改树索引并 flush 到磁盘
   *
   * 所有对 this._tree 的写操作必须通过此方法，保证并发安全。
   */
  private async _mutate(fn: (tree: ThreadsTreeFile) => void): Promise<void> {
    await this._writeQueue.enqueue(async () => {
      fn(this._tree);
      writeThreadsTree(this._dir, this._tree);
    });
  }
}
