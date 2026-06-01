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
    const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const err = (record.error && typeof record.error === "object" ? record.error : record) as Record<string, unknown>;
    throw new HttpError(
      response.status,
      typeof err.code === "string" ? err.code : "HTTP_ERROR",
      typeof err.message === "string" ? err.message : response.statusText,
      err.details
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
