/**
 * Object Method 残留 canonical 类型 —— **method 定义/执行契约已迁到 `executable/contract.ts`**
 * （三参 `ObjectMethod` / `ExecutableContext`）。本文件只保留尚未迁走的 outcome 形状：
 *
 * - MethodOutcome：method.exec 的显式返回结果
 * - normalizeMethodOutcome：把 exec 的三种返回形态规范化为 MethodOutcome
 */

import type { ContextWindow } from "./context-window.js";

/**
 * Method exec 的显式返回结果（平铺单形状，取代旧三态 union）。
 *
 * exec 也可以返回 undefined（成功）或裸 string（成功 + result 文本），
 * runtime（WindowManager.submit / execDirect / HTTP callMethod）统一规范化为本形状。
 *
 * - result：给 LLM / 用户的消息文本
 * - window：constructor method 构造的新 ContextWindow；runtime 自动 mount
 * - error：ok=false 时的错误描述
 * - data：结构化 JSON 数据。`for_ui_access` 的 object method 经 HTTP call_method
 *   调用时，前端从此字段取数渲染；LLM 路径不消费 data（只看 result 文本）。
 */
export type MethodOutcome = {
  ok: boolean;
  result?: string;
  window?: ContextWindow;
  error?: string;
  data?: unknown;
};

/**
 * 把 exec 的返回形态规范化为 MethodOutcome（运行态信封）：
 * - void / undefined → `{ ok: true }`
 * - 裸 string（sugar）→ `{ ok: true, result }`
 * - ObjectMethodResult `{ message?, data?, err? }`（method 作者形态）→ message→result / err→error / ok=!err
 * - 已是 MethodOutcome（运行态自产，含 `ok`）→ 原样透传
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

