/**
 * log-aggregator —— observable 维度的轻量「日志去重 + 限流 + 计数」原语。
 *
 * 动机（2026-06-06 harness 暴露）：programmable 维度体验官超时，服务端日志 370/370 行
 * 全是同一条 `[readThread] ... references missing object ... skipping`——无界重复把真信号
 * 淹没，且超时只能事后 tail 才诊断。observability 反模式：同一警告无聚合/限流。
 *
 * 本模块提供单一收口的 emit 点：
 * - **去重计数**：按 caller 给的稳定 `key` 累计同类事件次数（不同变量部分归一到一个 key）。
 * - **限流输出**：首 N 条直出、之后每 EMIT_EVERY 条采样一次（带 `(×count)` 总数后缀），
 *   既不刷屏又保留「还在发生 + 共多少次」的信号。
 * - **滚动 tally**：`logPatternSnapshot()` 给出按次数排序的 top 模式，供
 *   `/api/runtime/activity` 系统活动快照 / harness 超时快照消费——让长跑卡住可诊断。
 *
 * 进程级模块状态（console 本就是进程全局；harness 每维度独立 server 进程，天然隔离）。
 * 测试用 `__resetLogAggregator()` 复位。
 */

export type LogLevel = "info" | "warn" | "error";

/** 单个日志模式的聚合视图（供活动快照 / 诊断消费）。 */
export interface LogPattern {
  /** caller 给的稳定归一键（同类事件共享，变量部分不进 key）。 */
  key: string;
  level: LogLevel;
  /** 该 key 累计触发次数（含被限流抑制的）。 */
  count: number;
  /** 首次触发时间戳（ms）。 */
  firstTs: number;
  /** 最近一次触发时间戳（ms）。 */
  lastTs: number;
  /** 最近一次的完整消息（带变量部分，便于定位）。 */
  sample: string;
}

interface Entry {
  level: LogLevel;
  count: number;
  firstTs: number;
  lastTs: number;
  sample: string;
}

/** 首 N 条直出（让首次出现的问题立即可见）。 */
const EMIT_FIRST = 3;
/** 超过 EMIT_FIRST 后，每 EMIT_EVERY 条采样一次（证明「还在发生」而不刷屏）。 */
const EMIT_EVERY = 100;

const patterns = new Map<string, Entry>();

/** 限流判定：首 EMIT_FIRST 条直出，之后每 EMIT_EVERY 条一次。 */
function shouldEmit(count: number): boolean {
  return count <= EMIT_FIRST || count % EMIT_EVERY === 0;
}

function emit(level: LogLevel, text: string): void {
  // 本模块是日志唯一的「受控 console 收口」——其它处的刷屏警告应路由到这里而非裸 console。
  // eslint-disable-next-line no-console
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(text);
}

/**
 * 经聚合器记录并（限流地）输出一条日志。
 *
 * @param level   日志级别
 * @param key     稳定归一键（同类事件共享，如 "readThread.missing-object"——不要把 objectId
 *                等变量拼进 key，否则失去去重意义）
 * @param message 完整消息（含变量部分，作为 sample 保留并在采样输出时打印）
 * @param now     时间戳（默认 Date.now；测试可注入以确定化）
 */
export function observeLog(level: LogLevel, key: string, message: string, now: number = Date.now()): void {
  const prev = patterns.get(key);
  const count = (prev?.count ?? 0) + 1;
  patterns.set(key, {
    level,
    count,
    firstTs: prev?.firstTs ?? now,
    lastTs: now,
    sample: message,
  });
  if (shouldEmit(count)) {
    emit(level, count > 1 ? `${message} (×${count})` : message);
  }
}

/** observeLog 的 warn 便捷封装。 */
export function observeWarn(key: string, message: string, now?: number): void {
  observeLog("warn", key, message, now);
}

/**
 * 按累计次数降序返回 top-K 日志模式，供系统活动快照 / harness 超时快照消费。
 * 一眼看出「服务端此刻被什么重复事件主导」。
 */
export function logPatternSnapshot(topK = 10): LogPattern[] {
  return Array.from(patterns.entries())
    .map(([key, e]) => ({
      key,
      level: e.level,
      count: e.count,
      firstTs: e.firstTs,
      lastTs: e.lastTs,
      sample: e.sample,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topK);
}

/** 测试钩子：清空聚合器状态。 */
export function __resetLogAggregator(): void {
  patterns.clear();
}
