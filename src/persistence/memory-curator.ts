/**
 * MemoryCurator —— 结构化 memory 的周期性维护调度器
 *
 * 背景（Memory Curation Phase 2）：
 * - Phase 1 完成了结构化存储（entries/*.json）+ 查询 API
 * - super 分身会"沉淀"新 entry，但没有人周期性做"合并 + rebuild index"
 *   → 重复条目累积，index.md 与 entries 不一致
 * - MemoryCurator 扮演"清洁工"角色：每隔 N 秒或累积 M 条新 entry 后
 *   对所有注册对象跑一次 `mergeDuplicateEntries + rebuildMemoryIndex`
 *
 * 设计要点：
 * - **与 SuperScheduler 解耦**：super-scheduler 只消费 inbox；memory-curator
 *   只做 data-layer 维护。两者生命周期都绑定 World。
 * - **双触发**：时间 tick（默认 5 分钟）+ 计数 tick（累积 20 条新 entry）
 *   —— 任一满足就跑一次；跑完统计 reset
 * - **统计透明**：每次跑完返回 {mergedCount, keptCount, lastRunAt}，
 *   供 UI 健康度面板 / Stone Memory tab stats 读取
 * - **polling 而非 fs watch**：与 SuperScheduler 保持一致哲学
 * - **幂等 tick**：同一 stone 的 curation 不会并发重复（in-flight 标记）
 * - **graceful stop**：stop() 等所有 in-flight 完成
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_memory_curation_phase2.md
 * @ref kernel/src/persistence/memory-entries.ts — depends — mergeDuplicateEntries, rebuildMemoryIndex
 */

import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { consola } from "consola";

import { mergeDuplicateEntries, rebuildMemoryIndex } from "./memory-entries.js";

/**
 * 注册项：每个对象的数据目录
 *
 * selfDir 即 `stones/{stoneName}`——curator 只关心它下面的 `memory/entries/` 子目录
 */
interface MemoryCuratorRegistration {
  stoneName: string;
  selfDir: string;
  /** 上一次 curation 时该对象的 entry 文件数——用来算"累积了多少新 entry" */
  lastEntryCount: number;
  /** 上一次 curation 的时间（epoch ms）——用来算"距上次多久" */
  lastCurationAt: number;
}

/**
 * 单次 curation 的统计结果（供 UI 健康度 / 日志用）
 */
export interface CurationTickStat {
  stoneName: string;
  /** 被合并删除的 entry 数 */
  merged: number;
  /** 合并后剩余的 entry 数 */
  kept: number;
  /** 完成时间 ISO 8601 */
  at: string;
}

/**
 * MemoryCurator 配置
 */
export interface MemoryCuratorConfig {
  /** polling 间隔毫秒（默认 30 秒，跑一次"是否需要 curate"判断；curate 本身由触发条件决定） */
  tickIntervalMs?: number;
  /** 时间触发阈值（默认 5 分钟——距上次 curation 超过就触发） */
  timeThresholdMs?: number;
  /** 计数触发阈值（默认累积 20 条新 entry 就触发） */
  countThresholdEntries?: number;
}

/**
 * MemoryCurator —— 结构化 memory 周期维护调度器
 *
 * 生命周期：在 World.init 末尾 create + start；进程退出（SIGINT）时 stop。
 */
export class MemoryCurator {
  private readonly _tickIntervalMs: number;
  private readonly _timeThresholdMs: number;
  private readonly _countThresholdEntries: number;

  /** 按 stoneName 索引的注册表 */
  private readonly _registry = new Map<string, MemoryCuratorRegistration>();

  /** in-flight 对象集合（避免 tick 重复派发） */
  private readonly _inFlight = new Set<string>();

  /** 所有 in-flight 的 Promise，stop() 时等它们完成 */
  private _runnerPromises = new Set<Promise<void>>();

  /** 最近一次 curation 结果（每 stone 各一条，供 UI 读取） */
  private readonly _lastStats = new Map<string, CurationTickStat>();

  /** setInterval 句柄；null 表示未启动 */
  private _timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: MemoryCuratorConfig = {}) {
    this._tickIntervalMs = config.tickIntervalMs ?? 30_000;
    this._timeThresholdMs = config.timeThresholdMs ?? 5 * 60 * 1000;
    this._countThresholdEntries = config.countThresholdEntries ?? 20;
  }

  /**
   * 注册一个对象
   *
   * 幂等：多次注册同 stoneName 会覆盖（若 selfDir 相同则实际无副作用）
   */
  register(stoneName: string, selfDir: string): void {
    this._registry.set(stoneName, {
      stoneName,
      selfDir,
      lastEntryCount: this._countEntryFiles(selfDir),
      lastCurationAt: 0, /* 0 意味着首次启动时"一定触发一次"——确保冷启动时 index 即时刷新 */
    });
    consola.info(`[MemoryCurator] 注册 ${stoneName} → ${selfDir}`);
  }

  /** 注销 */
  unregister(stoneName: string): void {
    this._registry.delete(stoneName);
    this._lastStats.delete(stoneName);
  }

  /** 已注册的所有对象（sorted） */
  registered(): string[] {
    return Array.from(this._registry.keys()).sort();
  }

  /**
   * 查询某对象最近一次 curation 结果（UI 健康度面板用）
   * 返回 undefined 表示从未跑过
   */
  getLastStat(stoneName: string): CurationTickStat | undefined {
    return this._lastStats.get(stoneName);
  }

  /** 启动 polling loop（幂等） */
  start(): void {
    if (this._timer) {
      consola.warn("[MemoryCurator] 已启动，忽略重复 start");
      return;
    }
    consola.info(`[MemoryCurator] 启动 polling，tick=${this._tickIntervalMs}ms timeThreshold=${this._timeThresholdMs}ms countThreshold=${this._countThresholdEntries}`);
    this._timer = setInterval(() => {
      void this._tick().catch(err => consola.error("[MemoryCurator] tick 失败（已吞）:", err));
    }, this._tickIntervalMs);
    if (typeof this._timer === "object" && this._timer !== null && "unref" in this._timer) {
      (this._timer as { unref: () => void }).unref();
    }
  }

  /** 停止并等所有 in-flight 完成（graceful） */
  async stop(): Promise<void> {
    if (!this._timer) return;
    clearInterval(this._timer);
    this._timer = null;
    consola.info("[MemoryCurator] 停止 polling，等待 in-flight curation…");
    const pending = Array.from(this._runnerPromises);
    await Promise.allSettled(pending);
    consola.info(`[MemoryCurator] 已停止（等了 ${pending.length} 个 in-flight）`);
  }

  /**
   * 手动触发一次 tick（测试/调试用）；Promise resolve 时本轮所有 curation 都完成
   */
  async tickNow(): Promise<void> {
    await this._tick();
    const pending = Array.from(this._runnerPromises);
    await Promise.allSettled(pending);
  }

  /**
   * 强制立即对某个对象跑 curation（不判断触发条件；用于 LLM 手动 merge_memory_duplicates 的快路径）
   */
  async curateNow(stoneName: string): Promise<CurationTickStat | null> {
    const reg = this._registry.get(stoneName);
    if (!reg) return null;
    if (this._inFlight.has(stoneName)) return null; /* 跳过并发 */
    await this._runCuration(reg);
    return this._lastStats.get(stoneName) ?? null;
  }

  /* ========== 内部 ========== */

  private async _tick(): Promise<void> {
    const now = Date.now();
    for (const reg of this._registry.values()) {
      if (this._inFlight.has(reg.stoneName)) continue;
      const entryCount = this._countEntryFiles(reg.selfDir);
      const deltaCount = entryCount - reg.lastEntryCount;
      const deltaTime = now - reg.lastCurationAt;

      /* 首次（lastCurationAt===0）且目录有 entries → 触发一次冷启动 curate
       * 常规触发：时间阈值 OR 计数阈值 */
      const firstTime = reg.lastCurationAt === 0 && entryCount > 0;
      const timeTrigger = deltaTime >= this._timeThresholdMs && entryCount > 0;
      const countTrigger = deltaCount >= this._countThresholdEntries;

      if (!firstTime && !timeTrigger && !countTrigger) continue;

      /* 派发 runner */
      const p = this._runCuration(reg).finally(() => {
        this._runnerPromises.delete(p);
      });
      this._runnerPromises.add(p);
    }
  }

  /** 实际跑一个对象的 curation（merge + rebuild index） */
  private async _runCuration(reg: MemoryCuratorRegistration): Promise<void> {
    if (this._inFlight.has(reg.stoneName)) return;
    this._inFlight.add(reg.stoneName);
    try {
      const { merged, kept } = mergeDuplicateEntries(reg.selfDir);
      rebuildMemoryIndex(reg.selfDir, reg.stoneName);
      const stat: CurationTickStat = {
        stoneName: reg.stoneName,
        merged,
        kept,
        at: new Date().toISOString(),
      };
      this._lastStats.set(reg.stoneName, stat);
      reg.lastEntryCount = kept;
      reg.lastCurationAt = Date.now();
      if (merged > 0) {
        consola.info(`[MemoryCurator] ${reg.stoneName}: merged=${merged} kept=${kept}`);
      }
    } catch (err) {
      consola.error(`[MemoryCurator] ${reg.stoneName} curation 失败（已吞，不影响其他对象）:`, err);
    } finally {
      this._inFlight.delete(reg.stoneName);
    }
  }

  /**
   * 数 `{selfDir}/memory/entries/*.json` 文件数（便宜）
   *
   * 说明：只数 `.json`，忽略 `.embedding.json`（Phase 2 embedding 旁路文件，避免双倍计数）
   */
  private _countEntryFiles(selfDir: string): number {
    const dir = join(selfDir, "memory", "entries");
    if (!existsSync(dir)) return 0;
    try {
      return readdirSync(dir).filter(f => f.endsWith(".json") && !f.endsWith(".embedding.json")).length;
    } catch {
      return 0;
    }
  }
}
