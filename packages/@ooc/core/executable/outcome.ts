/**
 * Method 执行结果信封（运行态） —— `MethodOutcome` + 规范化。
 *
 * method exec 的三种作者返回形态（void / 裸 string / `ObjectMethodResult`）由 runtime
 * （`WindowManager.execObjectMethod` / HTTP `call_method`）统一规范化为 `MethodOutcome`。
 * `ObjectMethodResult`（作者形态）与 method 定义同处 `./contract.ts`；本文件只放运行态出参形状。
 */

/**
 * Method exec 的运行态结果信封（平铺单形状）。
 *
 * - ok：成败标志
 * - result：给 LLM / 用户的消息文本
 * - error：`ok=false` 时的错误描述
 * - data：结构化 JSON 数据。`for_ui_access` 的 object method 经 HTTP `call_method`
 *   调用时，前端从此字段取数渲染；LLM 路径不消费 data（只看 result 文本）。
 */
export type MethodOutcome = {
  ok: boolean;
  result?: string;
  error?: string;
  data?: unknown;
};

/**
 * 把 exec 的返回形态规范化为 `MethodOutcome`：
 * - void / undefined → `{ ok: true }`
 * - 裸 string（sugar）→ `{ ok: true, result }`
 * - `ObjectMethodResult` `{ message?, data?, err? }`（作者形态）→ message→result / err→error / ok=!err
 * - 已是 `MethodOutcome`（运行态自产，含 `ok`）→ 原样透传
 */
export function normalizeMethodOutcome(raw: unknown): MethodOutcome {
  if (typeof raw === "string") return { ok: true, result: raw };
  if (raw && typeof raw === "object") {
    if ("ok" in raw) return raw as MethodOutcome;
    const r = raw as { message?: string; data?: unknown; err?: string };
    if ("message" in r || "data" in r || "err" in r) {
      return { ok: r.err == null, result: r.message, error: r.err, data: r.data };
    }
  }
  return { ok: true };
}
