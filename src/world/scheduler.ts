/**
 * Scheduler — 异步消息调度器
 *
 * 管理多个 Flow 的交替执行。当 A talk B 时，消息投递到 B 的队列，
 * Scheduler 轮询所有有 pending work 的 Flow，每次运行一轮 ThinkLoop。
 *
 * 终止条件：入口 Flow 达到 finished/waiting/failed 且没有其他活跃 Flow。
 *
 * 错误传播：当 sub-flow 失败或超时时，自动向 initiatedBy 投递错误消息，
 * 让发送方的 LLM 感知到协作对象的失败。
 *
 * @ref docs/哲学文档/gene.md#G8 — implements — 多 Flow 调度与错误传播
 * @ref docs/哲学文档/gene.md#G2 — references — Flow 状态机驱动调度决策
 * @ref src/flow/flow.ts — references — Flow 实例
 * @ref src/flow/thinkloop.ts — references — runThinkLoop 执行引擎
 */

import { consola } from "consola";
import { Flow } from "../flow/index.js";
import { runThinkLoop } from "../flow/thinkloop.js";
import { emitSSE } from "../server/events.js";
import type { CollaborationAPI } from "./router.js";
import type { LLMClient } from "../thinkable/client.js";
import type { StoneData, DirectoryEntry, TraitDefinition, TraitTree, ThreadState } from "../types/index.js";
import type { CronManager } from "./cron.js";

/** Scheduler 中的 Flow 条目 */
interface SchedulerEntry {
  flow: Flow;
  stone: StoneData;
  stoneDir: string;
  traits: TraitDefinition[];
  /** trait 树形索引（用于 Progressive Disclosure） */
  traitTree: TraitTree[];
  collaboration: CollaborationAPI;
  /** 累计已执行的迭代次数 */
  iterations: number;
  /** 是否已投递过错误消息（防止重复投递） */
  errorPropagated: boolean;
}

/** Scheduler 配置 */
export interface SchedulerConfig {
  /** 单个 Flow 最大迭代次数 */
  maxIterationsPerFlow: number;
  /** 全局最大迭代次数（所有 Flow 合计） */
  maxTotalIterations: number;
}

const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  maxIterationsPerFlow: 100,
  maxTotalIterations: 200,
};

export class Scheduler {
  private readonly _entries = new Map<string, SchedulerEntry>();
  private readonly _llm: LLMClient;
  private readonly _directory: DirectoryEntry[];
  private readonly _config: SchedulerConfig;
  private readonly _isPaused?: (name: string) => boolean;
  private readonly _cron?: CronManager;
  private readonly _flowsDir?: string;
  private _entryFlowName: string = "";

  constructor(
    llm: LLMClient,
    directory: DirectoryEntry[],
    config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
    isPaused?: (name: string) => boolean,
    cron?: CronManager,
    flowsDir?: string,
  ) {
    this._llm = llm;
    this._directory = directory;
    this._config = config;
    this._isPaused = isPaused;
    this._cron = cron;
    this._flowsDir = flowsDir;
  }

  /**
   * 注册一个 Flow 到调度器
   */
  register(
    stoneName: string,
    flow: Flow,
    stone: StoneData,
    stoneDir: string,
    traits: TraitDefinition[],
    collaboration: CollaborationAPI,
    traitTree: TraitTree[] = [],
  ): void {
    this._entries.set(stoneName, {
      flow, stone, stoneDir, traits, traitTree, collaboration, iterations: 0, errorPropagated: false,
    });
  }

  /**
   * 运行调度循环
   *
   * @param entryFlowName - 入口 Flow 的对象名（人类发起的目标）
   * @returns 入口 Flow 的 Stone 数据
   */
  async run(entryFlowName: string): Promise<Record<string, unknown>> {
    this._entryFlowName = entryFlowName;
    let totalIterations = 0;

    consola.info(`[Scheduler] 开始调度，入口: ${entryFlowName}`);

    while (totalIterations < this._config.maxTotalIterations) {
      /* 找到所有有 pending work 的 Flow */
      const readyFlows = this._getReadyFlows();

      if (readyFlows.length === 0) {
        consola.info(`[Scheduler] 没有活跃的 Flow，结束调度`);
        break;
      }

      /* 轮询每个 ready Flow，支持并发线程 */
      for (const name of readyFlows) {
        if (totalIterations >= this._config.maxTotalIterations) break;

        const entry = this._entries.get(name)!;
        if (entry.iterations >= this._config.maxIterationsPerFlow) {
          consola.warn(`[Scheduler] ${name} 达到最大迭代次数，标记为失败`);
          entry.flow.setStatus("failed");
          entry.flow.recordAction({ type: "thought", content: `[超时] 达到最大迭代次数 ${this._config.maxIterationsPerFlow}` });
          entry.flow.save();
          this._propagateError(name, `${name} 执行超时（达到最大迭代次数）`);
          continue;
        }

        /* 检查是否有多个活跃线程需要并发执行 */
        const activeThreads = this._getActiveThreads(entry.flow);

        if (activeThreads.length > 1) {
          /* 并发模式：多个线程同时发起 LLM 请求 */
          consola.info(`[Scheduler] 并发调度 ${name}: ${activeThreads.length} 个线程 (${activeThreads.map(t => t.name).join(", ")})`);

          const promises = activeThreads.map((thread) =>
            runThinkLoop(
              entry.flow,
              entry.stone,
              entry.stoneDir,
              this._llm,
              this._directory,
              entry.traits,
              { maxIterations: 1000, isPaused: this._isPaused ? () => this._isPaused!(name) : undefined, emitProgress: false, threadId: thread.name },
              entry.collaboration,
              this._cron,
              this._flowsDir,
              entry.traitTree,
            ),
          );

          const results = await Promise.all(promises);

          /* 合并所有线程的 persistedData */
          for (const updatedData of results) {
            for (const [key, value] of Object.entries(updatedData)) {
              entry.stone.data[key] = value;
            }
          }

          entry.iterations += activeThreads.length;
          totalIterations += activeThreads.length;
        } else {
          /* 单线程模式 */
          const threadId = activeThreads.length === 1 ? activeThreads[0]!.name : undefined;
          consola.info(`[Scheduler] 调度 ${name} (第 ${entry.iterations + 1} 轮${threadId ? `, thread: ${threadId}` : ""})`);
          const updatedData = await runThinkLoop(
            entry.flow,
            entry.stone,
            entry.stoneDir,
            this._llm,
            this._directory,
            entry.traits,
            { maxIterations: 1000, isPaused: this._isPaused ? () => this._isPaused!(name) : undefined, emitProgress: false, threadId },
            entry.collaboration,
            this._cron,
            this._flowsDir,
            entry.traitTree,
          );

          entry.iterations++;
          totalIterations++;

          /* 同步 persistData 写入的数据到 stone（仅显式持久化的 key） */
          for (const [key, value] of Object.entries(updatedData)) {
            entry.stone.data[key] = value;
          }
        }

        /* 发射进度事件（Scheduler 统一发射，包含全局计数） */
        emitSSE({
          type: "flow:progress",
          objectName: name,
          taskId: entry.flow.sessionId,
          iterations: entry.iterations,
          maxIterations: this._config.maxIterationsPerFlow,
          totalIterations,
          maxTotalIterations: this._config.maxTotalIterations,
        });

        /* 检查 ThinkLoop 后是否失败，传播错误 */
        if (entry.flow.status === "failed") {
          this._propagateError(name, `${name} 执行失败`);
        }
      }

      /* 检查入口 Flow 是否完成 */
      const entryEntry = this._entries.get(entryFlowName);
      if (entryEntry) {
        const status = entryEntry.flow.status;
        if (status === "finished" || status === "failed" || status === "pausing") {
          consola.info(`[Scheduler] 入口 Flow ${entryFlowName} 状态: ${status}，结束调度`);
          break;
        }
        if (status === "waiting" && !this._hasOtherActiveFlows(entryFlowName)) {
          /* 入口 Flow 自身有 pending messages 时不终止，继续调度 */
          if (entryEntry.flow.hasPendingMessages) {
            entryEntry.flow.setStatus("running");
            continue;
          }
          if (entryFlowName === "user") {
            /* user 对象不参与 ThinkLoop，子 flow 全部完成后自动结束 */
            consola.info(`[Scheduler] user 入口 Flow waiting 且无其他活跃 Flow，标记为 finished`);
            entryEntry.flow.setStatus("finished");
          } else {
            consola.info(`[Scheduler] 入口 Flow waiting 且无其他活跃 Flow，结束调度`);
          }
          break;
        }
      }
    }

    if (totalIterations >= this._config.maxTotalIterations) {
      consola.warn(`[Scheduler] 达到全局最大迭代次数 ${this._config.maxTotalIterations}，强制结束`);
    }

    consola.info(`[Scheduler] 调度结束，共 ${totalIterations} 轮`);

    const entryEntry = this._entries.get(entryFlowName);
    return entryEntry ? { ...entryEntry.stone.data } : {};
  }

  /**
   * 向 initiatedBy 投递错误消息
   *
   * 当 sub-flow 失败或超时时，自动通知消息发送方。
   */
  private _propagateError(failedName: string, errorMessage: string): void {
    const entry = this._entries.get(failedName);
    if (!entry || entry.errorPropagated) return;

    const initiatedBy = entry.flow.initiatedBy;
    if (!initiatedBy) return;

    const targetEntry = this._entries.get(initiatedBy);
    if (!targetEntry) return;

    consola.info(`[Scheduler] 错误传播: ${failedName} → ${initiatedBy}`);
    targetEntry.flow.deliverMessage(failedName, `[系统通知] ${errorMessage}`);
    targetEntry.flow.addMessage({
      direction: "in",
      from: failedName,
      to: initiatedBy,
      content: `[系统通知] ${errorMessage}`,
    });
    entry.errorPropagated = true;
  }

  /** 获取所有有 pending work 的 Flow 名称 */
  private _getReadyFlows(): string[] {
    const ready: string[] = [];
    for (const [name, entry] of this._entries) {
      /* user 对象不参与 ThinkLoop（由人类控制） */
      if (name === "user") continue;

      const flow = entry.flow;
      /* running 状态 或 waiting 但有 pending messages */
      if (flow.status === "running") {
        ready.push(name);
      } else if (flow.status === "waiting" && flow.hasPendingMessages) {
        /* 有新消息到达，重新激活 */
        flow.setStatus("running");
        ready.push(name);
      }
    }
    return ready;
  }

  /** 检查是否有其他活跃的 Flow */
  private _hasOtherActiveFlows(excludeName: string): boolean {
    for (const [name, entry] of this._entries) {
      if (name === excludeName) continue;
      if (entry.flow.status === "running") return true;
      /* waiting 但有 pending messages 也算活跃（即将被唤醒） */
      if (entry.flow.status === "waiting" && entry.flow.hasPendingMessages) return true;
    }
    return false;
  }

  /**
   * 获取 Flow 中所有活跃的线程
   *
   * 如果 Flow 没有初始化 threads，返回空数组（走默认单线程路径）。
   * 只返回 status 为 "running" 的线程。
   */
  private _getActiveThreads(flow: Flow): ThreadState[] {
    const threads = flow.process.threads;
    if (!threads || Object.keys(threads).length === 0) return [];
    return Object.values(threads).filter((t) => t.status === "running");
  }
}
