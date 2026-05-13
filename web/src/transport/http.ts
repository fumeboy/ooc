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
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const err = data?.error ?? data;
    throw new HttpError(response.status, err?.code ?? "HTTP_ERROR", err?.message ?? response.statusText, err?.details);
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

