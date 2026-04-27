/**
 * SuperScheduler —— 跨 session 常驻的 super 线程调度器
 *
 * 背景与哲学（G12 完整工程闭环）：
 * - `handleOnTalkToSuper`（collaborable/super/super.ts）只做"落盘 + 复活"：把 talk(target="super")
 *   的消息写到 `stones/{name}/super/` 的 root 线程 inbox。
 * - 但没有调度器去**消费**那些 inbox 消息——它们会静静躺着，直到某个外力驱动
 *   super 线程跑一轮 ThinkLoop。
 * - 普通 session 的 `ThreadScheduler` 生命周期与 session 绑定（每次 world.talk 结束
 *   就销毁）；super 线程跨 session 常驻，需要独立的长生命周期调度器。
 * - SuperScheduler 就是这个角色——**进程级单例**，polling 扫所有注册的 super 目录，
 *   发现 unread inbox 就触发一次 engine 执行（ThinkLoop 跑到没 unread 或线程 done）。
 *
 * 设计要点：
 * - **polling 而非 fs watch**：写入路径多样（超长路径/容器/NFS），polling 语义清晰；
 *   成本极低（stat + 读 JSON），默认 3s tick。
 * - **runner 依赖注入**：本文件只负责"找到需要跑的对象 + 串行化调度"，真正的
 *   engine 执行由外部注入——测试时 mock、生产时注入 `runSuperThread`。这保证
 *   super-scheduler 本身可以独立单元测试。
 * - **SerialQueue 按 stoneName 串行化**：同一个 stone 的 super 线程不会并发跑多轮；
 *   不同 stone 互不阻塞。
 * - **错误隔离**：单个对象 runner 失败不阻塞其他对象；也不阻塞后续 tick。
 * - **幂等 tick**：同一个 stone 的 runner 正在跑时，新 tick 不会重复触发（跳过）。
 * - **graceful stop**：stop() 会等当前 in-flight runner 完成再返回。
 *
 * 与老 `reflect-scheduler.ts`（SuperFlow 转型前已删除）的区别：
 * - 老的针对 `reflect/` 目录 + `reflective/reflect_flow` trait
 * - 新的针对 `super/` 目录 + `reflective/super` trait
 * - 新的是真正"常驻 polling"，老的只有骨架未接入 World
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_super_scheduler.md
 * @ref docs/哲学文档/gene.md#G12 — implements — 经验沉淀循环的调度器
 * @ref kernel/src/collaborable/super/super.ts — references — handleOnTalkToSuper 的落盘伙伴
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { consola } from "consola";

import { ThreadsTree } from "../../thread/tree.js";
import { SerialQueue } from "../../shared/utils/serial-queue.js";
import { getSuperThreadDir } from "./super.js";

/**
 * 单个 super 目录运行一轮 ThinkLoop 的 runner 接口
 *
 * 实现（生产）：engine.runSuperThread（Phase 3 实装）
 * 实现（测试）：mock 函数——验证调度时机和串行化行为
 *
 * runner 的职责：
 * 1. 从 superDir 加载 ThreadsTree
 * 2. 如果 root 线程有 unread inbox → 跑一轮 scheduler（消费 inbox）
 * 3. 跑完返回——线程可能 running/waiting/done，下次 tick 继续检查
 *
 * runner 不应抛错泄露出来（SuperScheduler 有兜底 catch，但 runner 自己也该健壮）。
 */
export type SuperRunner = (params: {
  stoneName: string;
  superDir: string;
}) => Promise<void>;

/**
 * SuperScheduler 配置
 */
export interface SuperSchedulerConfig {
  /** polling 间隔，毫秒（默认 3000） */
  tickIntervalMs?: number;
  /** 注入的 runner——每次 tick 检测到 unread inbox 时调用 */
  runner: SuperRunner;
}

/**
 * 注册项：每个对象的 super 目录
 */
interface SuperRegistration {
  stoneName: string;
  superDir: string;
}

/**
 * SuperScheduler —— 跨 session 常驻调度器
 *
 * 生命周期：
 * - 在 World 初始化时创建并 start()
 * - 进程关闭时 stop()（graceful shutdown）
 */
export class SuperScheduler {
  private readonly _tickIntervalMs: number;
  private readonly _runner: SuperRunner;

  /** 按 stoneName 索引的注册表（一个 stone 最多一个 super） */
  private readonly _registry = new Map<string, SuperRegistration>();

  /** 按 stoneName 串行化的队列（同 stone 的 runner 不会并发） */
  private readonly _queue = new SerialQueue<string>();

  /** 正在执行 runner 的 stone 集合（避免 tick 重复派发） */
  private readonly _inFlight = new Set<string>();

  /** setInterval 句柄；undefined 表示未启动 */
  private _timer: ReturnType<typeof setInterval> | null = null;

  /** stop() 时挂起的 flush 集合——等所有 in-flight runner 结束 */
  private _runnerPromises = new Set<Promise<void>>();

  constructor(config: SuperSchedulerConfig) {
    this._tickIntervalMs = config.tickIntervalMs ?? 3000;
    this._runner = config.runner;
  }

  /**
   * 注册一个对象的 super 目录
   *
   * 幂等：多次注册同一 stoneName 会覆盖旧的 superDir（通常相同，无副作用）。
   *
   * @param stoneName 对象名
   * @param rootDir user repo 根目录（用于拼 superDir）
   */
  register(stoneName: string, rootDir: string): void {
    const superDir = getSuperThreadDir(rootDir, stoneName);
    this._registry.set(stoneName, { stoneName, superDir });
    consola.info(`[SuperScheduler] 注册 ${stoneName} → ${superDir}`);
  }

  /**
   * 注销（World 层可能在对象删除时调用——本阶段未使用，预留）
   */
  unregister(stoneName: string): void {
    this._registry.delete(stoneName);
    consola.info(`[SuperScheduler] 注销 ${stoneName}`);
  }

  /**
   * 当前注册的所有对象（供调试/健康检查用）
   */
  registered(): string[] {
    return Array.from(this._registry.keys()).sort();
  }

  /**
   * 启动 polling loop
   *
   * 幂等：多次 start 只会启动一个 timer。
   */
  start(): void {
    if (this._timer) {
      consola.warn("[SuperScheduler] 已启动，忽略重复 start");
      return;
    }
    consola.info(`[SuperScheduler] 启动 polling，tick=${this._tickIntervalMs}ms`);
    /* 使用 unref 确保 scheduler 不阻塞进程退出；如果 Node 主循环没其他事，Node 会自然退出 */
    this._timer = setInterval(() => {
      void this._tick().catch(err => {
        consola.error("[SuperScheduler] tick 失败（已吞）:", err);
      });
    }, this._tickIntervalMs);
    if (typeof this._timer === "object" && this._timer !== null && "unref" in this._timer) {
      (this._timer as { unref: () => void }).unref();
    }
  }

  /**
   * 停止 polling，等待所有 in-flight runner 完成
   *
   * 幂等：多次 stop 不会重复等待。
   */
  async stop(): Promise<void> {
    if (!this._timer) return;
    clearInterval(this._timer);
    this._timer = null;
    consola.info("[SuperScheduler] 停止 polling，等待 in-flight runner…");
    /* 等所有 in-flight runner 完成 */
    const pending = Array.from(this._runnerPromises);
    await Promise.allSettled(pending);
    consola.info(`[SuperScheduler] 已停止（等了 ${pending.length} 个 in-flight）`);
  }

  /**
   * 手动触发一次 tick（测试用——跳过 interval 等待）
   *
   * 返回 Promise：等到本次 tick 排队的所有 runner 完成才 resolve。
   */
  async tickNow(): Promise<void> {
    await this._tick();
    /* 等本轮 tick 派发的所有 runner 完成（包括被排在 SerialQueue 尾部的） */
    const pending = Array.from(this._runnerPromises);
    await Promise.allSettled(pending);
  }

  /* ========== 内部 ========== */

  /**
   * 单轮 tick：扫所有注册对象，对有 unread inbox 的触发 runner
   */
  private async _tick(): Promise<void> {
    for (const reg of this._registry.values()) {
      /* 已有 in-flight runner → 跳过（幂等） */
      if (this._inFlight.has(reg.stoneName)) continue;

      /* 快速判断是否需要运行——避免每个 tick 都激活 engine */
      if (!this._needsRun(reg.superDir)) continue;

      /* 派发 runner（SerialQueue 保证同 stoneName 顺序；不同 stoneName 并发） */
      this._inFlight.add(reg.stoneName);
      const p = this._queue
        .enqueue(reg.stoneName, async () => {
          try {
            await this._runner({ stoneName: reg.stoneName, superDir: reg.superDir });
          } catch (err) {
            consola.error(`[SuperScheduler] runner(${reg.stoneName}) 失败（已吞，不影响其他对象）:`, err);
          }
        })
        .finally(() => {
          this._inFlight.delete(reg.stoneName);
          this._runnerPromises.delete(p);
        });
      this._runnerPromises.add(p);
    }
  }

  /**
   * 判断一个 super 目录是否需要跑一轮
   *
   * 条件：
   * 1. `{superDir}/threads.json` 存在（已有 super 线程）
   * 2. rootId 对应的 thread.json 中 inbox 至少一条 `status === "unread"`
   *
   * 优化：用 ThreadsTree.load 读一次，避免重复 IO
   */
  private _needsRun(superDir: string): boolean {
    if (!existsSync(join(superDir, "threads.json"))) return false;

    try {
      const tree = ThreadsTree.load(superDir);
      if (!tree) return false;
      const rootData = tree.readThreadData(tree.rootId);
      if (!rootData?.inbox) return false;
      return rootData.inbox.some(m => m.status === "unread");
    } catch (err) {
      consola.warn(`[SuperScheduler] _needsRun(${superDir}) 检查失败:`, err);
      return false;
    }
  }
}
