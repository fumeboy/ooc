/**
 * log-aggregator —— 单一受控 console 收口，按稳定 key 去重计数 + 限流 + top 模式。
 *
 * 设计权威：`.ooc-world-meta/.../children/observable/knowledge/observability-trio.md`。
 *
 * 核心：把「无界刷屏的同类警告」收敛成「首 N 条直出 + 之后采样带 (×count) + 滚动 top 模式」。
 *
 * 单一收口规则：observable 维度的所有日志只经 `observeLog` / `observeWarn` 出口，**不直接 `console.warn`**。
 */

interface LogTally {
  key: string;
  count: number;
  firstAt: number;
  lastAt: number;
  lastMessage: string;
  level: "log" | "warn";
}

const tallies = new Map<string, LogTally>();
const HEAD_VERBATIM = 3; // 首 3 条直出
const SAMPLE_EVERY = 100; // 之后每 100 条采样

function emit(level: "log" | "warn", key: string, message: string): void {
  const now = Date.now();
  const existing = tallies.get(key);
  if (!existing) {
    tallies.set(key, { key, count: 1, firstAt: now, lastAt: now, lastMessage: message, level });
    if (level === "warn") console.warn(message);
    else console.log(message);
    return;
  }
  existing.count++;
  existing.lastAt = now;
  existing.lastMessage = message;
  // 首 HEAD_VERBATIM 条直出
  if (existing.count <= HEAD_VERBATIM) {
    if (level === "warn") console.warn(message);
    else console.log(message);
    return;
  }
  // 之后每 SAMPLE_EVERY 条采样带 ×count
  if (existing.count % SAMPLE_EVERY === 0) {
    const sampled = `${message} (×${existing.count})`;
    if (level === "warn") console.warn(sampled);
    else console.log(sampled);
  }
}

/** 通用日志（info）。`key` 是稳定归一键（同类事件共享）；message 是当下文本。 */
export function observeLog(key: string, message: string): void {
  emit("log", key, message);
}

/** 警告日志。同一 key 共享去重/限流计数。 */
export function observeWarn(key: string, message: string): void {
  emit("warn", key, message);
}

/** 滚动 tally 快照（给 `/api/runtime/activity` 的 logPatterns 字段）。 */
export interface LogPatternSnapshot {
  key: string;
  count: number;
  level: "log" | "warn";
  firstAt: number;
  lastAt: number;
  lastMessage: string;
}

export function logPatternSnapshot(limit = 10): LogPatternSnapshot[] {
  return Array.from(tallies.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** 清空 tally（测试用）。 */
export function __resetLogAggregatorForTests(): void {
  tallies.clear();
}
