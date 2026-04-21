/**
 * ReflectScheduler —— 跨 session 常驻的反思线程调度器（ReflectFlow 方案 B Phase 1）
 *
 * 反思线程与普通 session 线程有本质不同：
 * - 落盘在 `stones/{name}/reflect/`，生命周期**独立于任何 session**
 * - 可以在多个 session 之间共享（对象的"长期反思"）
 * - 没有用户驱动——inbox 里积累的消息来自 `talkToSelf` 投递，需要主动轮询/触发
 *
 * 本调度器只负责"扫描 + 触发"，**具体的 ThinkLoop 执行由注入的 runner 回调完成**
 * （避免把 engine 的依赖耦合进来）。典型注入路径：
 *   1. World 初始化时创建 scheduler，runner 里写"为反思线程跑一轮 engine"
 *   2. 每个对象启动时调 `register(stoneName, stoneDir)`
 *   3. `talkToReflect` 投递消息后，显式调 `triggerReflect(stoneName)` 让 scheduler 立即 tick
 *   4. 可选：启动时 `scanAll()` 扫一遍所有注册对象（处理残留未读）
 *
 * **为什么不做进程内 polling**：OOC 优先事件驱动，polling 浪费 CPU 且不能做到及时响应。
 * 调用方要"守着"某个对象就主动调 trigger；不关心就不调——零开销。
 *
 * @ref docs/工程管理/迭代/all/20260421_feature_ReflectFlow方案B.md — 迭代文档
 * @ref docs/工程管理/迭代/finish/20260421_feature_ReflectFlow线程树化.md — 方案 A（前置）
 * @ref kernel/src/thread/reflect.ts — references — 反思线程 ThreadsTree 管理 API
 */

import { consola } from "consola";
import { ThreadsTree } from "./tree.js";
import { getReflectThreadDir } from "./reflect.js";

/** Runner 接口：执行一次反思线程的 ThinkLoop */
export interface ReflectRunnerContext {
  /** 对象名（如 "bruce"） */
  stoneName: string;
  /** 对象自身目录（如 `/path/to/stones/bruce`） */
  stoneDir: string;
  /** 反思线程目录（`{stoneDir}/reflect`） */
  reflectDir: string;
  /** 反思线程树（已 load） */
  tree: ThreadsTree;
}

/** 执行器签名：接收上下文，跑一轮思考；抛错不影响其他对象的调度 */
export type ReflectRunner = (ctx: ReflectRunnerContext) => Promise<void>;

/** 已注册的对象条目 */
interface RegisteredStone {
  stoneName: string;
  stoneDir: string;
}

/**
 * ReflectScheduler —— 反思线程调度器
 */
export class ReflectScheduler {
  /** 注册表：stoneName → RegisteredStone */
  private _registry = new Map<string, RegisteredStone>();

  /**
   * @param runner - 真正执行 ThinkLoop 的回调（由 World 注入）
   */
  constructor(private _runner: ReflectRunner) {}

  /**
   * 注册一个对象的反思线程到调度器
   *
   * 注册后可通过 `triggerReflect(stoneName)` 或 `scanAll()` 驱动。
   */
  register(stoneName: string, stoneDir: string): void {
    this._registry.set(stoneName, { stoneName, stoneDir });
  }

  /**
   * 注销对象（对象被删除 / 不再参与反思时用）
   */
  unregister(stoneName: string): void {
    this._registry.delete(stoneName);
  }

  /**
   * 获取已注册对象列表（便于调试 / 遍历）
   */
  getRegistered(): RegisteredStone[] {
    return Array.from(this._registry.values());
  }

  /**
   * 触发指定对象的反思线程一次：
   *   1. load 反思 ThreadsTree（未初始化 → 直接返回）
   *   2. 检查 root 线程 inbox 有无 `status=unread` 消息
   *   3. 有 → 调 runner 跑一轮；无 → 静默返回
   *
   * **语义**：这是"条件触发"，不保证 ThinkLoop 执行完整度——runner 如何跑一轮、
   * 跑几轮，由 runner 自己决定。Scheduler 只做门卫。
   *
   * @param stoneName - 对象名
   */
  async triggerReflect(stoneName: string): Promise<void> {
    const entry = this._registry.get(stoneName);
    if (!entry) return; /* 未注册——静默忽略（宽松语义） */

    const reflectDir = getReflectThreadDir(entry.stoneDir);
    const tree = ThreadsTree.load(reflectDir);
    if (!tree) return; /* 反思线程还没初始化——没消息要反思 */

    const data = tree.readThreadData(tree.rootId);
    const unreadCount = (data?.inbox ?? []).filter(m => m.status === "unread").length;
    if (unreadCount === 0) return;

    try {
      await this._runner({
        stoneName,
        stoneDir: entry.stoneDir,
        reflectDir,
        tree,
      });
      consola.info(`[ReflectScheduler] 已触发 ${stoneName} 反思（未读 ${unreadCount} 条）`);
    } catch (err: any) {
      /* 单个 runner 失败不污染其他对象调度 */
      consola.error(`[ReflectScheduler] ${stoneName} 反思执行失败:`, err?.message ?? err);
    }
  }

  /**
   * 扫描所有已注册对象，逐个 triggerReflect
   *
   * 用途：
   * - 服务启动时一次性处理所有残留的未读消息
   * - 定期（如 cron）清扫
   *
   * 设计：串行而非并行——反思 ThinkLoop 可能耗 LLM 配额，同时触发 10 个对象会炸 API。
   */
  async scanAll(): Promise<void> {
    const stones = this.getRegistered();
    for (const s of stones) {
      await this.triggerReflect(s.stoneName);
    }
  }
}
