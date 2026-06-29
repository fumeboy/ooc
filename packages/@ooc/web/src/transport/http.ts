/**
 * `requestJson<T>(path, init?)` — web 端唯一 HTTP fetcher。
 *
 * **2026-06-29 历史**: 一度被桩化为 TODO(commit cf2448d0),让所有 server 对接成可见
 * 桩位。S1 (issue 2026-06-29-s1-file-edit-read-primitive) 落地时**恢复真实实现** —
 * S1+S2 起,各 domain query.ts 逐个解桩,需要真 fetch。
 *
 * 错误模型: 非 2xx response 抛 HttpError(status,code,message,details?);body 解析失败
 * 也包成 HttpError。各 domain query 通过 transport/errors.ts 的 messageFromError 显
 * 示。
 *
 * `qs()` 工具函数始终保留 — 纯字符串拼接,不与 server 对接,各 query.ts 都用到。
 */
import { HttpError } from "./errors";

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: { code: "HTTP_ERROR", message: text || response.statusText } };
  }
  if (!response.ok) {
    const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const err = (record.error && typeof record.error === "object" ? record.error : record) as Record<string, unknown>;
    throw new HttpError(
      response.status,
      typeof err.code === "string" ? err.code : "HTTP_ERROR",
      typeof err.message === "string" ? err.message : response.statusText,
      err.details,
    );
  }
  return data as T;
}

export function qs(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const raw = search.toString();
  return raw ? `?${raw}` : "";
}
