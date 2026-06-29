/**
 * `requestJson<T>(path, init?)` — web 端唯一 HTTP fetcher。
 *
 * **2026-06-29 桩化裁决** : 把所有 server 对接的地方统一删除,替换为 TODO 桩位,
 * 忘记已有的设计,然后重新实现。本文件作为 fetch 总入口被桩化:任何调用都抛
 * `[TODO] ${context}` 错误,让 UI 在桩点上行为可见、迫使重新实现时显式接通。
 *
 * 重新实现时:恢复 fetch + JSON 解析 + HttpError 包装(可参考 git history 拿
 * 旧实现作起点)。
 *
 * `qs()` 工具函数保留 — 纯字符串拼接,不与 server 对接,各 query.ts 都用到。
 */
import { HttpError } from "./errors";

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  void init;
  throw new HttpError(
    501,
    "TODO",
    `[TODO] requestJson 已桩化(2026-06-29); 重新实现时恢复 fetch + JSON 解析 + 错误包装。 path=${path}`,
  );
}

export function qs(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const raw = search.toString();
  return raw ? `?${raw}` : "";
}
