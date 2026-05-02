/**
 * ThreadScheduler — 事件驱动的线程级调度器
 *
 * 核心设计：
 * - 每个线程是独立的 async loop（不用 Promise.all 同步）
 * - 扁平调度：不关心线程父子关系或所属 Object，只看 status
 * - 事件驱动：被动响应线程状态变化（done/failed → 唤醒等待者）
 * - 全局安全阀：总迭代上限 + 单线程迭代上限 + 死锁检测
 *
 * 与旧 Scheduler 的区别：
 * - 旧：轮询所有 Flow，每轮调度一个 Flow 的一次 ThinkLoop
 * - 新：每个线程独立循环，快线程不等慢线程
 * - 旧：以 Flow（Object）为调度单位
 * - 新：以线程（ProcessNode）为调度单位
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#6
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#8
 */

import { consola } from "consola";
import type { ThreadsTreeNodeMeta, ThreadStatus } from "../thread-tree/types.js";

/* ========== 类型定义 ========== */

/** Scheduler 配置 */
export interface ThreadSchedulerConfig {
  /** 单个线程最大迭代次数 */
  maxIterationsPerThread: number;
  /** 全局最大迭代次数（所有线程合计，等价于 Session 超时） */
  maxTotalIterations: number;
  /** 死锁检测宽限期（毫秒），默认 30000 */
  deadlockGracePeriodMs: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: ThreadSchedulerConfig = {
  maxIterationsPerThread: 100,
  maxTotalIterations: 500,
  deadlockGracePeriodMs: 30_000,
};

/**
 * Scheduler 回调接口
 *
 * Scheduler 本身不依赖 ThinkLoop / LLM / Flow，
 * 通过回调接口与外部解耦。调用方（World）负责注入具体实现。
 */
export interface SchedulerCallbacks {
  /**
   * 执行一轮 ThinkLoop 迭代
   * @param threadId - 线程 ID（ProcessNode.id）
   * @param objectName - 所属 Object 名称
   */
  runOneIteration: (threadId: string, objectName: string) => Promise<void>;

  /**
   * 线程完成回调（done 或 failed）
   * @param threadId - 线程 ID
   * @param objectName - 所属 Object 名称
   */
  onThreadFinished: (threadId: string, objectName: string) => void;

  /**
   * 错误通知回调（向 creatorThreadId 投递错误消息）
   * @param threadId - 接收错误通知的线程 ID
   * @param objectName - 所属 Object 名称
   * @param error - 错误描述
   */
  onThreadError: (threadId: string, objectName: string, error: string) => void;
}

/**
 * 线程运行时跟踪信息（Scheduler 内部使用）
 */
interface ThreadTracker {
  /** 线程 ID */
  threadId: string;
  /** 所属 Object 名称 */
  objectName: string;
  /** 累计迭代次数 */
  iterations: number;
  /** 当前 async loop 的 Promise（null = 未启动或已结束） */
  loopPromise: Promise<void> | null;
  /** 是否已投递过错误通知（防止重复） */
  errorPropagated: boolean;
}

/* ========== ThreadScheduler ========== */

export class ThreadScheduler {
  /** 配置 */
  private readonly _config: ThreadSchedulerConfig;
  /** 暂停的 Object 集合 */
  private readonly _pausedObjects = new Set<string>();
  /** 全局迭代计数 */
  private _totalIterations = 0;
  /** 线程跟踪表：threadId → ThreadTracker */
  private _trackers = new Map<string, ThreadTracker>();
  /** 活跃的 loop Promise 集合（用于 waitAll） */
  private _activeLoops = new Map<string, Promise<void>>();
  /** 内存树引用（run 时注入） */
  private _tree: { getNode: (id: string) => ThreadsTreeNodeMeta | null; readonly nodeIds: string[]; setNodeStatus: (id: string, status: ThreadStatus) => Promise<void> } | null = null;
  /** 回调引用（run 时注入） */
  private _callbacks: SchedulerCallbacks | null = null;
  /** 当前 Object 名称 */
  private _objectName: string = "";
  /** _forceFailAllRunning 是否已执行（I5: 防止多线程同时调用） */
  private _forceFailExecuted = false;
  /** 活跃 loop 计数器 + resolve 回调（I1: 替代 Promise.all） */
  private _activeCount = 0;
  private _allDoneResolve: (() => void) | null = null;

  constructor(config: Partial<ThreadSchedulerConfig> = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  /* ========== 公开 API ========== */

  /**
   * 运行调度循环
   *
   * 扫描线程树中所有 running 线程，为每个启动独立 async loop。
   * 等待所有 loop 结束后返回。
   *
   * @param objectName - Object 名称
   * @param tree - 线程树内存模型（阶段 2 的 ThreadsTree）
   * @param callbacks - 回调接口
   */
  async run(
    objectName: string,
    tree: { getNode: (id: string) => ThreadsTreeNodeMeta | null; readonly nodeIds: string[]; setNodeStatus: (id: string, status: ThreadStatus) => Promise<void> },
    callbacks: SchedulerCallbacks,
  ): Promise<void> {
    this._tree = tree;
    this._callbacks = callbacks;
    this._objectName = objectName;
    this._totalIterations = 0;
    this._trackers.clear();
    this._activeLoops.clear();
    this._forceFailExecuted = false;
    this._activeCount = 0;
    this._allDoneResolve = null;

    consola.info(`[ThreadScheduler] 开始调度 ${objectName}`);

    /* 如果 Object 被暂停，直接返回 */
    if (this._pausedObjects.has(objectName)) {
      consola.info(`[ThreadScheduler] ${objectName} 已暂停，跳过调度`);
      return;
    }

    /* 扫描所有 running 线程，启动 loop */
    for (const nodeId of tree.nodeIds) {
      const node = tree.getNode(nodeId);
      if (node && node.status === "running") {
        this._startThread(node.id, objectName);
      }
    }

    /* 等待所有 loop 结束 */
    await this._waitAll();

    /* 死锁检测（I2: 只运行一次，已知限制，后续迭代改进） */
    await this._checkDeadlock(objectName);

    consola.info(`[ThreadScheduler] 调度结束 ${objectName}，共 ${this._totalIterations} 轮`);
  }

  /**
   * 新线程注册（运行时动态创建的线程）
   *
   * 由 do(fork) 调用。
   * 如果 Scheduler 正在运行，立即启动新线程的 loop。
   */
  onThreadCreated(threadId: string, objectName: string): void {
    if (!this._tree || !this._callbacks) return;
    const node = this._tree.getNode(threadId);
    if (!node || node.status !== "running") return;
    this._startThread(threadId, objectName);
  }

  /** 暂停 Object 的所有线程（当前迭代完成后生效） */
  pauseObject(objectName: string): void {
    this._pausedObjects.add(objectName);
    consola.info(`[ThreadScheduler] 暂停 ${objectName}`);
  }

  /** 恢复 Object 的所有线程 */
  resumeObject(objectName: string): void {
    this._pausedObjects.delete(objectName);
    consola.info(`[ThreadScheduler] 恢复 ${objectName}`);
  }

  /* ========== 内部方法 ========== */

  /**
   * 启动单个线程的独立循环
   */
  private _startThread(threadId: string, objectName: string): void {
    /* 如果 loop 正在运行，防止重复启动 */
    if (this._activeLoops.has(threadId)) return;

    /* 复用或创建 tracker */
    let tracker = this._trackers.get(threadId);
    if (!tracker) {
      tracker = {
        threadId,
        objectName,
        iterations: 0,
        loopPromise: null,
        errorPropagated: false,
      };
      this._trackers.set(threadId, tracker);
    }

    this._activeCount++;
    const loop = this._runThreadLoop(tracker).finally(() => {
      this._activeCount--;
      this._activeLoops.delete(threadId);
      /* 当所有 loop 结束时，通知 _waitAll */
      if (this._activeCount === 0 && this._allDoneResolve) {
        this._allDoneResolve();
        this._allDoneResolve = null;
      }
    });
    tracker.loopPromise = loop;
    this._activeLoops.set(threadId, loop);
  }

  /**
   * 单个线程的独立循环
   *
   * while (status === "running") { runOneIteration }
   * 循环退出条件：
   * - status 变为 waiting/done/failed
   * - 单线程迭代上限
   * - 全局迭代上限
   * - Object 被暂停
   */
  private async _runThreadLoop(tracker: ThreadTracker): Promise<void> {
    const { threadId, objectName } = tracker;
    const tree = this._tree!;
    const callbacks = this._callbacks!;

    consola.info(`[ThreadScheduler] 启动线程循环 ${threadId} (${objectName})`);

    while (true) {
      const node = tree.getNode(threadId);
      if (!node || node.status !== "running") break;

      /* 检查暂停 */
      if (this._pausedObjects.has(objectName)) {
        consola.info(`[ThreadScheduler] ${threadId} 暂停中，退出循环`);
        break;
      }

      /* 检查单线程迭代上限 */
      if (tracker.iterations >= this._config.maxIterationsPerThread) {
        const reason = `线程 ${threadId} 达到单线程迭代上限 ${this._config.maxIterationsPerThread}`;
        consola.warn(`[ThreadScheduler] ${reason}，标记 failed`);
        await tree.setNodeStatus(threadId, "failed");
        /* I4: 错误传播统一由 _onThreadFinished 处理 */
        await this._onThreadFinished(threadId, objectName, reason);
        break;
      }

      /* 检查全局迭代上限 */
      if (this._totalIterations >= this._config.maxTotalIterations) {
        const reason = `达到全局迭代上限 ${this._config.maxTotalIterations}`;
        consola.warn(`[ThreadScheduler] ${reason}，${threadId} 标记 failed`);
        await tree.setNodeStatus(threadId, "failed");
        await this._onThreadFinished(threadId, objectName, reason);
        /* I5: 全局超时强制失败，只执行一次 */
        await this._forceFailAllRunning();
        break;
      }

      /* 执行一轮迭代 */
      try {
        await callbacks.runOneIteration(threadId, objectName);
      } catch (e) {
        const errMsg = (e as Error).message;
        consola.error(`[ThreadScheduler] ${threadId} 迭代异常:`, errMsg);
        await tree.setNodeStatus(threadId, "failed");
        /* I4: 错误传播统一由 _onThreadFinished 处理，传递原始错误信息 */
        await this._onThreadFinished(threadId, objectName, errMsg);
        break;
      }

      tracker.iterations++;
      this._totalIterations++;

      /* 迭代后检查状态变化 */
      const updatedNode = tree.getNode(threadId);
      if (!updatedNode || updatedNode.status !== "running") {
        /* 状态已变（waiting/done/failed），退出循环 */
        if (updatedNode && (updatedNode.status === "done" || updatedNode.status === "failed")) {
          await this._onThreadFinished(threadId, objectName);
        }
        break;
      }
    }
  }

  /**
   * 线程结束回调
   *
   * 1. 通知 creatorThreadId（失败时投递错误消息）
   * 2. 检查 awaitingChildren → 唤醒等待者
   * 3. 调用外部 onThreadFinished 回调
   *
   * I4: 错误传播统一在此处理，_runThreadLoop 中不再显式调用 _propagateError。
   */
  private async _onThreadFinished(threadId: string, objectName: string, errorMessage?: string): Promise<void> {
    const tree = this._tree!;
    const callbacks = this._callbacks!;
    const node = tree.getNode(threadId);
    if (!node) return;

    consola.info(`[ThreadScheduler] 线程结束 ${threadId} (${node.status})`);

    /* 失败时通知创建者；根线程无创建者时把错误写回自身，供 failureReason 落盘。 */
    if (node.status === "failed") {
      const message = errorMessage ?? `线程 ${threadId} 执行失败`;
      if (node.creatorThreadId) {
        this._propagateError(threadId, message);
      } else {
        callbacks.onThreadError(threadId, objectName, message);
      }
    }

    /* 调用外部回调 */
    callbacks.onThreadFinished(threadId, objectName);

    /* 检查是否有等待者需要唤醒 */
    await this._checkAndWakeWaiters(threadId);
  }

  /**
   * 检查并唤醒等待者
   *
   * 遍历所有 waiting 线程，检查其 awaitingChildren 是否全部 done/failed。
   * 如果是，将等待者状态改为 running 并启动新的 loop。
   */
  private async _checkAndWakeWaiters(finishedThreadId: string): Promise<void> {
    const tree = this._tree!;

    for (const nodeId of tree.nodeIds) {
      const node = tree.getNode(nodeId);
      if (!node || node.status !== "waiting") continue;
      if (!node.awaitingChildren || node.awaitingChildren.length === 0) continue;

      /* 检查 awaitingChildren 是否全部完成 */
      const allDone = node.awaitingChildren.every((childId) => {
        const child = tree.getNode(childId);
        return child && (child.status === "done" || child.status === "failed");
      });

      if (allDone) {
        await this._wakeThread(node.id, this._objectName);
      }
    }
  }

  /**
   * 唤醒等待中的线程
   *
   * 将 status 改为 running，启动新的 async loop。
   *
   * I3 设计决策：迭代计数累积
   * prevIterations 保留了线程被唤醒前的迭代次数，唤醒后继续累加。
   * 这意味着一个线程的总迭代次数 = 所有 running 阶段的迭代之和。
   * 这是有意为之：防止线程通过反复 waiting/running 绕过单线程迭代上限。
   */
  private async _wakeThread(threadId: string, objectName: string): Promise<void> {
    const tree = this._tree!;
    const node = tree.getNode(threadId);
    if (!node || node.status !== "waiting") return;

    consola.info(`[ThreadScheduler] 唤醒线程 ${threadId}`);
    await tree.setNodeStatus(threadId, "running");

    /* 清除旧 tracker，创建新的（保留累计迭代次数） */
    const oldTracker = this._trackers.get(threadId);
    const prevIterations = oldTracker?.iterations ?? 0;

    this._trackers.delete(threadId);

    const tracker: ThreadTracker = {
      threadId,
      objectName,
      iterations: prevIterations,
      loopPromise: null,
      errorPropagated: false,
    };
    this._trackers.set(threadId, tracker);

    this._activeCount++;
    const loop = this._runThreadLoop(tracker).finally(() => {
      this._activeCount--;
      this._activeLoops.delete(threadId);
      if (this._activeCount === 0 && this._allDoneResolve) {
        this._allDoneResolve();
        this._allDoneResolve = null;
      }
    });
    tracker.loopPromise = loop;
    this._activeLoops.set(threadId, loop);
  }

  /**
   * 向 creatorThreadId 投递错误消息
   */
  private _propagateError(failedThreadId: string, errorMessage: string): void {
    const tree = this._tree!;
    const callbacks = this._callbacks!;
    const tracker = this._trackers.get(failedThreadId);
    if (tracker?.errorPropagated) return;

    const node = tree.getNode(failedThreadId);
    if (!node?.creatorThreadId) return;

    const creatorNode = tree.getNode(node.creatorThreadId);
    if (!creatorNode) {
      /* 孤儿线程：创建者不存在（可能在另一个 Object） */
      if (node.creatorObjectName) {
        consola.info(`[ThreadScheduler] 跨 Object 错误传播: ${failedThreadId} → ${node.creatorObjectName}:${node.creatorThreadId}`);
        callbacks.onThreadError(node.creatorThreadId, node.creatorObjectName, errorMessage);
      }
    } else {
      consola.info(`[ThreadScheduler] 错误传播: ${failedThreadId} → ${node.creatorThreadId}`);
      callbacks.onThreadError(node.creatorThreadId, this._objectName, errorMessage);
    }

    if (tracker) tracker.errorPropagated = true;
  }

  /**
   * 死锁检测
   *
   * 条件：running=0 且 waiting>0
   * 处理：宽限期后唤醒所有 waiting 线程
   *
   * I2 已知限制：死锁检测只在 run() 的初始 loop 全部结束后运行一次。
   * 如果唤醒后的线程再次形成死锁，不会被二次检测。
   * 后续迭代可改为周期性检测或在 _waitAll 返回时自动触发。
   */
  private async _checkDeadlock(objectName: string): Promise<void> {
    const tree = this._tree!;

    /** 辅助：收集指定状态的节点 */
    const collectByStatus = (status: ThreadStatus): ThreadsTreeNodeMeta[] => {
      const result: ThreadsTreeNodeMeta[] = [];
      for (const nodeId of tree.nodeIds) {
        const node = tree.getNode(nodeId);
        if (node && node.status === status) result.push(node);
      }
      return result;
    };

    const runningNodes = collectByStatus("running");
    const waitingNodes = collectByStatus("waiting");

    if (runningNodes.length > 0 || waitingNodes.length === 0) return;

    /* 区分内部等待和跨 Object 等待 */
    const internalWaiting = waitingNodes.filter(n => {
      if (!n.awaitingChildren || n.awaitingChildren.length === 0) return false;
      /* 所有等待的子线程都在本 Object 内 */
      return n.awaitingChildren.every(childId => tree.getNode(childId) !== null);
    });

    if (internalWaiting.length === 0) {
      /* 全部是跨 Object 等待，不算死锁 */
      consola.info(`[ThreadScheduler] ${objectName} 所有线程等待跨 Object 响应，非死锁`);
      return;
    }

    consola.warn(`[ThreadScheduler] 检测到潜在死锁: running=0, waiting=${waitingNodes.length}`);

    /* 宽限期 */
    if (this._config.deadlockGracePeriodMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this._config.deadlockGracePeriodMs));

      /* 宽限期后重新检查 */
      const recheckRunning = collectByStatus("running");
      const recheckWaiting = collectByStatus("waiting");
      if (recheckRunning.length > 0 || recheckWaiting.length === 0) return;
    }

    /* 确认死锁，唤醒所有 waiting 线程 */
    consola.warn(`[ThreadScheduler] 确认死锁，唤醒所有 waiting 线程`);
    for (const node of waitingNodes) {
      await this._wakeThread(node.id, objectName);
    }

    /* 等待唤醒后的 loop 结束 */
    await this._waitAll();
  }

  /**
   * 强制将所有 running 线程标记为 failed（全局超时时调用）
   *
   * I5: 使用 _forceFailExecuted flag 确保只执行一次，
   * 防止多个线程同时触发全局上限时重复调用。
   */
  private async _forceFailAllRunning(): Promise<void> {
    if (this._forceFailExecuted) return;
    this._forceFailExecuted = true;

    const tree = this._tree!;
    for (const nodeId of tree.nodeIds) {
      const node = tree.getNode(nodeId);
      if (node && node.status === "running") {
        await tree.setNodeStatus(node.id, "failed");
      }
    }
  }

  /**
   * 等待所有活跃的 loop 结束
   *
   * I1: 使用计数器方案替代 Promise.all。
   * _startThread 时 increment，loop finally 时 decrement。
   * 当计数器归零时 resolve。
   * 这样即使 loop 中动态启动新 loop（如 _wakeThread），也能正确等待。
   */
  private async _waitAll(): Promise<void> {
    if (this._activeCount === 0) return;
    return new Promise<void>((resolve) => {
      this._allDoneResolve = resolve;
    });
  }
}
