/**
 * LLM 调用 timeout 兜底。
 *
 * 背景: src/thinkable/scheduler.ts:131 -> think -> llmClient.generate 之间没有 timeout。
 * 进程被 SIGKILL / 网络挂死 / 代理服务卡住时, generate 永远不返回, scheduler 这一 tick
 * 卡死, thread.json 也不会落盘。
 *
 * 实现取最简: 在 createLlmClient 外层包一层 Promise.race + setTimeout 兜底, 不依赖
 * provider 是否原生支持 AbortController。default 120000ms, 由环境变量 OOC_LLM_TIMEOUT_MS
 * 覆写。timeout 触发抛 LlmTimeoutError (Error 子类), 消息含已等待 ms。
 */

// 240s：opus 级模型 + 大 context + extended thinking 单轮常 >120s（自循环 dogfooding 实测：
// 120s 默认会把正常的深思轮判为超时、硬杀整个 thread）。仍可由 OOC_LLM_TIMEOUT_MS 覆写。
const DEFAULT_TIMEOUT_MS = 240_000;

/** 解析 OOC_LLM_TIMEOUT_MS 环境变量, 缺省 / 非法时回到 DEFAULT_TIMEOUT_MS。 */
export function readLlmTimeoutMs(): number {
  const raw = process.env.OOC_LLM_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return parsed;
}

/**
 * 解析本次 generate 实际生效的超时 ms（根因 #1，2026-05-27）。
 *
 * 优先级：任务级 override（合法正数）> 全局默认（readLlmTimeoutMs）。
 * override 非法（undefined / 非有限 / <=0）时回落全局默认 — 不静默吞掉非法值，
 * 而是按"未设置"处理（与 readLlmTimeoutMs 对待非法 env 的策略一致）。
 */
export function resolveLlmTimeoutMs(overrideMs?: number): number {
  if (overrideMs !== undefined && Number.isFinite(overrideMs) && overrideMs > 0) {
    return overrideMs;
  }
  return readLlmTimeoutMs();
}

/** LLM 调用超时错误; thinkloop 的 catch 块会把它转成 thread.status="failed"。 */
export class LlmTimeoutError extends Error {
  readonly waitedMs: number;
  constructor(waitedMs: number) {
    super(`LLM 调用超时 (已等待 ${waitedMs}ms); 由 OOC_LLM_TIMEOUT_MS 控制`);
    this.name = "LlmTimeoutError";
    this.waitedMs = waitedMs;
  }
}

/**
 * 包装一个 Promise, 超过 timeoutMs 抛 LlmTimeoutError。
 *
 * 不持有 AbortController — provider 不支持取消时, 底层请求会继续在后台跑直到自然返回,
 * 但 scheduler 这一 tick 已经被解开。这是兜底语义, 不追求精确取消。
 */
export async function withLlmTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new LlmTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
