/**
 * Flow —— 动态执行对象 (G2, G4, G8)
 *
 * Flow 是 Stone 在执行任务时的动态派生。
 * 它拥有思考能力、执行能力、状态机、消息记录。
 * Flow 是 OOC 中「做事情」的核心单元。
 *
 * 所有 action 存储在行为树节点上，通过 focus 机制实现结构化遗忘。
 *
 * @ref docs/哲学文档/gene.md#G2 — implements — Flow 动态形态（状态机 running→waiting→finished/failed）
 * @ref docs/哲学文档/gene.md#G8 — implements — 异步消息投递（deliverMessage, drainPendingMessages）
 * @ref docs/哲学文档/gene.md#G10 — implements — recordAction 不可变事件记录
 * @ref docs/哲学文档/gene.md#G7 — implements — Flow 持久化（save/load → effects/{taskId}/）
 * @ref src/types/flow.ts — references — FlowData, FlowStatus, Action, PendingMessage 类型
 * @ref src/process/tree.ts — references — createProcess, appendAction, collectAllActions
 * @ref src/persistence/writer.ts — references — writeFlow 持久化
 * @ref src/persistence/reader.ts — references — readFlow 加载
 */

import { join, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { writeFlow, readFlow } from "../persistence/index.js";
import { emitSSE } from "../server/events.js";
import { createProcess } from "../process/tree.js";
import { collectAllActions, findNode, appendAction } from "../process/tree.js";
import type { FlowData, FlowStatus, Action, FlowMessage, PendingMessage, Process } from "../types/index.js";

/** 生成唯一任务 ID */
function generateTaskId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  return `task_${ts}_${rand}`;
}

/** 生成唯一消息 ID */
function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 生成唯一 Action ID */
function generateActionId(): string {
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Flow 实例 */
export class Flow {
  /** Flow 的持久化目录路径 */
  private readonly _dir: string;
  /** 当前数据 */
  private _data: FlowData;
  /** 覆盖的 shared 目录（sub-flow 复用 main flow 的 shared/） */
  private _sharedDirOverride?: string;

  private constructor(dir: string, data: FlowData, sharedDirOverride?: string) {
    this._dir = dir;
    this._data = data;
    this._sharedDirOverride = sharedDirOverride;
  }

  /* ========== 静态工厂方法 ========== */

  /**
   * 创建新的 Flow
   *
   * 自动创建根 process，所有 action 将记录在行为树节点上。
   *
   * @param flowsDir - 顶层 flows/ 目录（如 flows/）
   * @param stoneName - 所属 Stone 名称
   * @param initialMessage - 触发任务的初始消息
   * @param from - 消息发送者
   * @returns 新建的 Flow 实例
   */
  static create(
    flowsDir: string,
    stoneName: string,
    initialMessage: string,
    from: string = "human",
    initiatedBy?: string,
  ): Flow {
    const taskId = generateTaskId();
    const now = Date.now();

    const data: FlowData = {
      taskId,
      stoneName,
      status: "running",
      messages: [
        {
          direction: "in",
          from,
          to: stoneName,
          content: initialMessage,
          timestamp: now,
        },
      ],
      process: createProcess("task"),
      data: {},
      initiatedBy,
      createdAt: now,
      updatedAt: now,
    };

    /* main flow 目录：flows/{taskId}/flows/{stoneName}/ */
    const sessionDir = join(flowsDir, taskId);
    const dir = join(sessionDir, "flows", stoneName);
    writeFlow(dir, data);
    writeFileSync(join(dir, ".flow"), "", "utf-8");
    return new Flow(dir, data);
  }

  /**
   * 创建 Sub-flow（在 session 的 flows/ 子目录下）
   *
   * Sub-flow 是完整的 Flow 对象，持久化在 session 的 flows/{stoneName}/ 下。
   * 同一 Stone 在同一 session 下只有一个 sub-flow。
   * Sub-flow 使用自己的 shared/ 目录（flows/{taskId}/flows/{stoneName}/shared/）。
   *
   * @ref docs/建模/meta_thought.md#五 — implements — Sub-flow 持久化在 session 子目录
   *
   * @param sessionDir - session 根目录（如 flows/{taskId}/）
   * @param stoneName - sub-flow 所属的 Stone 名称
   * @param initialMessage - 触发消息
   * @param from - 消息发送者
   * @param initiatedBy - 发起者
   * @returns 新建的 Sub-flow 实例
   */
  static createSubFlow(
    sessionDir: string,
    stoneName: string,
    _initialMessage: string,
    _from: string,
    initiatedBy?: string,
  ): Flow {
    const now = Date.now();
    /* sub-flow 的 taskId 用 stoneName 标识（同一 session 下唯一） */
    const taskId = `sub_${stoneName}_${now.toString(36)}`;

    /* 不在此处写入初始消息到 messages[]。
     * 调用方通过 deliverMessage() 投递到 pendingMessages，
     * ThinkLoop 消费时统一调用 addMessage() 写入，避免重复。 */
    const data: FlowData = {
      taskId,
      stoneName,
      status: "running",
      messages: [],
      process: createProcess("task"),
      data: {},
      initiatedBy,
      createdAt: now,
      updatedAt: now,
    };

    const dir = join(sessionDir, "flows", stoneName);
    writeFlow(dir, data);
    writeFileSync(join(dir, ".flow"), "", "utf-8");
    return new Flow(dir, data);
  }

  /**
   * 从持久化目录加载 Flow
   *
   * @param dir - Flow 目录路径
   * @returns Flow 实例，若不存在返回 null
   */
  static load(dir: string): Flow | null {
    const data = readFlow(dir);
    if (!data) return null;
    return new Flow(dir, data);
  }

  /**
   * 创建或加载 ReflectFlow（原 SelfMeta）
   *
   * ReflectFlow 是对象的常驻 Flow，负责维护 Self（Stone）的长期数据。
   * taskId 固定为 `_reflect`，初始 status 为 waiting。
   * 如果已存在则 load，不重复创建。
   *
   * @param reflectDir - Stone 的 reflect/ 目录（如 stones/{name}/reflect/）
   * @param stoneName - 所属 Stone 名称
   * @returns ReflectFlow 实例
   */
  static ensureReflectFlow(reflectDir: string, stoneName: string): Flow {
    const existing = Flow.load(reflectDir);
    if (existing) return existing;

    const now = Date.now();
    const data: FlowData = {
      taskId: "_reflect",
      stoneName,
      status: "waiting",
      messages: [],
      process: createProcess("selfmeta"),
      data: {},
      isSelfMeta: true,
      createdAt: now,
      updatedAt: now,
    };

    writeFlow(reflectDir, data);
    return new Flow(reflectDir, data);
  }

  /* ========== 只读属性 ========== */

  get taskId(): string { return this._data.taskId; }
  get stoneName(): string { return this._data.stoneName; }
  get status(): FlowStatus { return this._data.status; }
  get messages(): readonly FlowMessage[] { return this._data.messages; }
  get dir(): string { return this._dir; }
  /** session 根目录（flows/{taskId}/），所有同 session 的 flow 共享此目录 */
  get sessionDir(): string { return resolve(this._dir, "..", ".."); }
  get sharedDir(): string { return this._sharedDirOverride ?? join(this._dir, "shared"); }
  get process(): Process { return this._data.process; }
  get initiatedBy(): string | undefined { return this._data.initiatedBy; }

  /** 是否为 SelfMeta Flow */
  get isSelfMeta(): boolean { return this._data.isSelfMeta === true; }

  /** 获取 flow 摘要（对象自主更新，用于跨 flow 记忆） */
  get summary(): string | undefined { return this._data.summary; }

  /** 设置 flow 摘要 */
  setSummary(summary: string): void {
    this._data = {
      ...this._data,
      summary,
      updatedAt: Date.now(),
    };
  }

  /** 从行为树收集所有 actions（按时间排序的扁平视图） */
  get actions(): readonly Action[] {
    return collectAllActions(this._data.process.root);
  }

  /* ========== 状态操作 ========== */

  /**
   * 更新 Flow 状态
   */
  setStatus(status: FlowStatus): void {
    this._data = {
      ...this._data,
      status,
      updatedAt: Date.now(),
    };
    emitSSE({ type: "flow:status", objectName: this.stoneName, taskId: this.taskId, status });
  }

  /**
   * 记录一个事件到当前 focus 节点
   */
  recordAction(action: Omit<Action, "timestamp" | "id">): void {
    const fullAction: Action = {
      id: generateActionId(),
      ...action,
      timestamp: Date.now(),
    };
    appendAction(this._data.process, this._data.process.focusId, fullAction);
    this._data = {
      ...this._data,
      updatedAt: Date.now(),
    };
    emitSSE({ type: "flow:action", objectName: this.stoneName, taskId: this.taskId, action: fullAction });
  }

  /**
   * 添加一条消息
   */
  addMessage(msg: Omit<FlowMessage, "timestamp" | "id">): void {
    /* 去重：检查最近 5 条消息中是否有相同 from+content 的消息 */
    const recent = this._data.messages.slice(-5);
    const isDuplicate = recent.some(
      m => m.from === msg.from && m.content === msg.content && m.direction === msg.direction,
    );
    if (isDuplicate) return;

    const fullMsg: FlowMessage = {
      id: generateMessageId(),
      ...msg,
      timestamp: Date.now(),
    };
    this._data = {
      ...this._data,
      messages: [...this._data.messages, fullMsg],
      updatedAt: Date.now(),
    };
    emitSSE({ type: "flow:message", objectName: this.stoneName, taskId: this.taskId, message: fullMsg });
  }

  /**
   * 设置行为树
   */
  setProcess(process: Process): void {
    this._data = {
      ...this._data,
      process,
      updatedAt: Date.now(),
    };
  }

  /**
   * 设置 Flow 级数据（用于 context windows 等）
   */
  setFlowData(key: string, value: unknown): void {
    this._data = {
      ...this._data,
      data: { ...this._data.data, [key]: value },
      updatedAt: Date.now(),
    };
  }

  /* ========== 异步消息 ========== */

  /**
   * 投递一条待处理消息
   *
   * @returns 消息 ID
   */
  deliverMessage(from: string, content: string, replyTo?: string): string {
    /* 去重：检查 pendingMessages 中是否已有相同 from+content 的消息 */
    const pending = this._data.pendingMessages ?? [];
    const isDuplicate = pending.some(
      m => m.from === from && m.content === content,
    );
    if (isDuplicate) {
      const existing = pending.find(m => m.from === from && m.content === content)!;
      return existing.id;
    }

    const id = generateMessageId();
    const msg: PendingMessage = {
      id,
      from,
      content,
      replyTo,
      timestamp: Date.now(),
    };
    this._data = {
      ...this._data,
      pendingMessages: [...pending, msg],
      updatedAt: Date.now(),
    };

    /* 如果当前是 waiting，收到消息后立即转为 running，确保 Scheduler 能调度 */
    if (this._data.status === "waiting") {
      this._data = { ...this._data, status: "running" };
    }

    return id;
  }

  /**
   * 取出所有待处理消息（清空队列）
   */
  drainPendingMessages(): PendingMessage[] {
    const msgs = this._data.pendingMessages ?? [];
    if (msgs.length > 0) {
      this._data = {
        ...this._data,
        pendingMessages: [],
        updatedAt: Date.now(),
      };
    }
    return msgs;
  }

  /**
   * 是否有待处理消息
   */
  get hasPendingMessages(): boolean {
    return (this._data.pendingMessages ?? []).length > 0;
  }

  /**
   * 设置等待回复的消息 ID
   */
  setWaitingForReply(messageId: string | undefined): void {
    this._data = {
      ...this._data,
      waitingForReply: messageId,
      updatedAt: Date.now(),
    };
  }

  /**
   * 获取等待回复的消息 ID
   */
  get waitingForReply(): string | undefined {
    return this._data.waitingForReply;
  }

  /* ========== 持久化 ========== */

  /**
   * 保存当前状态到文件系统
   */
  save(): void {
    writeFlow(this._dir, this._data);
  }

  /**
   * 获取完整数据快照
   */
  toJSON(): FlowData {
    return { ...this._data };
  }
}
