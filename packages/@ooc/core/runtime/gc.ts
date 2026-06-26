/**
 * core/runtime/gc —— 定时 GC：清理 done/failed thread 残留的入度（issue E）。
 *
 * 历史问题：close 原语会即时把 ref 从 thread.contextWindows 移除并触发 dispatchUnactive；但
 * thread 自然结束（status → done/failed）路径下，contextWindows 还残留着 refs，被它持有的对象
 * 永远 refcount > 0、永远不进 unactive。close 即时仍保留，GC 双轨兜底这条遗失通道。
 *
 * 算法（每 interval 跑一次，默认 600s）：
 *
 *   **Pass 1** —— 扫全 session inst → `thinkable.active?.(inst.data) === false` 即视为终态：
 *     从 ObjectInsRegistry 移除该 inst（这等价于把它出度的 refs 一次性 decRef，因为
 *     computeRefcount 经 `iterObjects` 看不到它了）。被移除的 inst 其它实例还引它的话，pass2
 *     里 refcount==0 的目标自然被处理；引向"被移除 inst"的 ref 当前规则下也算等价孤悬，按现在的
 *     需求不主动消除——thread close/move 自行处理。
 *
 *   **Pass 2** —— 扫全 session inst → 若 `computeRefcount(inst) === 0` 且尚未被本轮处理 →
 *     调 `dispatchUnactive(inst.id)`。dispatchUnactive 必须**幂等**（已 unactive 的 inst 再调
 *     静默跳过），让 GC 与 close 即时触发并存不重复执行。
 *
 * core 不知 thread 长什么样、不知 unactive 怎么 dispatch；调用方（如 thread builtin）经 opts 注入
 * `dispatchUnactive`。GC 只负责"定时扫 + 编排"。
 */
import type { ObjectInsRegistry } from "./object-registry.js";
import { computeRefcount } from "./refcount.js";

/** 默认 GC 周期（ms）。issue E 裁决：600s。 */
export const DEFAULT_GC_INTERVAL_MS = 600_000;

export interface StartSessionGcOpts {
  /** GC 周期；缺省 `DEFAULT_GC_INTERVAL_MS`。 */
  intervalMs?: number;
  /**
   * 拿到 session 的 ObjectInsRegistry —— core 不假定其存在性，调用方注入。
   * 缺省直接 `getSessionRegistry(sessionId)`（见 object-registry.ts），但允许测试 stub。
   */
  resolveRegistry?: (sessionId: string) => ObjectInsRegistry | undefined;
  /**
   * 兜底触发某 inst 的 unactive 钩子。必须**幂等**：已 unactive 的 inst 再调静默跳过。
   * 由 thread builtin / 其它持 lifecycle 钩子的 owner 注入实现。
   */
  dispatchUnactive?: (sessionId: string, objectId: string) => Promise<void> | void;
}

/**
 * 启动一个 session 的定时 GC。返回 `dispose` 函数（清 interval）。
 *
 * 单实例多调用幂等性由调用方负责（同一 sessionId 多次启动会得到独立 interval，建议只启一次）。
 */
export function startSessionGc(
  sessionId: string,
  opts: StartSessionGcOpts = {},
): () => void {
  const intervalMs = opts.intervalMs ?? DEFAULT_GC_INTERVAL_MS;
  const handle = setInterval(() => {
    void runGcOnce(sessionId, opts).catch((err) => {
      // GC 错误不抛出运行时，仅日志兜底
      console.warn(`[gc] session=${sessionId} pass error: ${(err as Error).message}`);
    });
  }, intervalMs);
  return () => clearInterval(handle);
}

/**
 * 触发一次 GC pass（pass1 + pass2）—— 暴露出来供测试 / close 路径手动触发。
 */
export async function runGcOnce(
  sessionId: string,
  opts: StartSessionGcOpts = {},
): Promise<void> {
  const resolveRegistry = opts.resolveRegistry;
  const registry = resolveRegistry ? resolveRegistry(sessionId) : undefined;
  if (!registry) return;

  // Pass 1：扫所有 inst，找 active===false 终态 → 从 registry 移除。
  const terminal: string[] = [];
  registry.iterObjects((inst) => {
    const thinkable = registry.resolveThinkable(inst.class);
    if (!thinkable?.active) return;
    if (thinkable.active(inst.data) === false) {
      terminal.push(inst.id);
    }
  });
  for (const id of terminal) {
    registry.removeObject(id);
  }

  // Pass 2：扫剩余 inst，refcount==0 → dispatchUnactive。
  if (!opts.dispatchUnactive) return;
  const zeroRefIds: string[] = [];
  registry.iterObjects((inst) => {
    if (computeRefcount(sessionId, inst.id, registry) === 0) {
      zeroRefIds.push(inst.id);
    }
  });
  for (const id of zeroRefIds) {
    await opts.dispatchUnactive(sessionId, id);
  }
}
