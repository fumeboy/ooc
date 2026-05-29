/**
 * OOC-3 API client — typed functions for each backend endpoint.
 *
 * All endpoints target ooc-3's new routes (no ooc-2 compat shims).
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { ok: false, error: text || res.statusText };
  }
  if (!res.ok) {
    const d = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const msg = typeof d.error === "string" ? d.error : res.statusText;
    throw new ApiError(res.status, "HTTP_ERROR", msg);
  }
  return data as T;
}

function qs(params: Record<string, string | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") s.set(k, v);
  }
  const raw = s.toString();
  return raw ? `?${raw}` : "";
}

/* -------- world -------- */

export interface WorldConfig {
  ok: boolean;
  worldRoot: string;
  branch: string;
}

export function getWorld(): Promise<WorldConfig> {
  return req<WorldConfig>("/api/world");
}

/* -------- sessions -------- */

export interface Session {
  sessionId: string;
  createdAt?: string;
  threadCount: number;
}

export interface SessionsResponse {
  ok: boolean;
  sessions: Session[];
}

export function listSessions(): Promise<SessionsResponse> {
  return req<SessionsResponse>("/api/sessions");
}

export interface SessionDetail {
  ok: boolean;
  sessionId: string;
  threads: Array<{
    id: string;
    objectUri: string;
    status: string;
    ticks: number;
    maxTicks: number;
    lastError?: string;
    messageCount: number;
  }>;
}

export function getSession(sessionId: string): Promise<SessionDetail> {
  return req<SessionDetail>(`/api/sessions/${encodeURIComponent(sessionId)}`);
}

export interface CreateSessionInput {
  objectUri: string;
  systemPrompt?: string;
  maxTicks?: number;
  sessionId?: string;
}

export interface CreatedSession {
  ok: boolean;
  sessionId: string;
  threadId: string;
}

export function createSession(input: CreateSessionInput): Promise<CreatedSession> {
  return req<CreatedSession>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* -------- stones -------- */

export interface StoneListItem {
  uri: string;
  name: string;
  title?: string;
  kind: string;
}

export interface StonesResponse {
  ok: boolean;
  branch: string;
  stones: StoneListItem[];
}

export function listStones(branch = "main"): Promise<StonesResponse> {
  return req<StonesResponse>(`/api/stones${qs({ branch })}`);
}

export interface StoneDetail {
  ok: boolean;
  uri: string;
  name: string;
  branch: string;
  paths: { stone: string; pool: string };
  self: string;
  readme: string | null;
  hasServer: boolean;
  hasClient: boolean;
}

export function getStone(branch: string, name: string): Promise<StoneDetail> {
  return req<StoneDetail>(`/api/stones/${encodeURIComponent(branch)}/${encodeURIComponent(name)}`);
}

export function getStoneSelf(branch: string, name: string): Promise<{ ok: boolean; content: string }> {
  return req(`/api/stones/${encodeURIComponent(branch)}/${encodeURIComponent(name)}/self`);
}

export function getStoneReadme(branch: string, name: string): Promise<{ ok: boolean; content: string }> {
  return req(`/api/stones/${encodeURIComponent(branch)}/${encodeURIComponent(name)}/readme`);
}

export function getStoneServerSource(branch: string, name: string): Promise<{ ok: boolean; content: string }> {
  return req(`/api/stones/${encodeURIComponent(branch)}/${encodeURIComponent(name)}/server-source`);
}

export interface CallMethodInput {
  method: string;
  args?: unknown;
  sessionId?: string;
}

export function callStoneMethod(
  branch: string,
  name: string,
  input: CallMethodInput,
): Promise<{ ok: boolean; result: unknown }> {
  return req(`/api/stones/${encodeURIComponent(branch)}/${encodeURIComponent(name)}/call-method`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* -------- flows / objects -------- */

export interface FlowObject {
  name: string;
  uri: string;
  kind: string;
}

export interface FlowObjectsResponse {
  ok: boolean;
  sessionId: string;
  objects: FlowObject[];
}

export function getFlowObjects(sessionId: string): Promise<FlowObjectsResponse> {
  return req<FlowObjectsResponse>(`/api/flows/${encodeURIComponent(sessionId)}/objects`);
}

export interface FlowObjectDetail {
  ok: boolean;
  sessionId: string;
  objectName: string;
  plan: string | null;
  todos: unknown;
  talks: Array<{ peer: string; entries: unknown[] }>;
  threadIds: string[];
  activeThreads: Array<{
    id: string;
    status: string;
    ticks: number;
    maxTicks: number;
    messageCount: number;
    lastError?: string;
  }>;
}

export function getFlowObject(sessionId: string, objectName: string): Promise<FlowObjectDetail> {
  return req<FlowObjectDetail>(
    `/api/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectName)}`,
  );
}

/* -------- threads -------- */

export type ThreadMessage =
  | { type: "message"; role: "system" | "user" | "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: Record<string, unknown> | string }
  | { type: "function_call_output"; call_id: string; name?: string; output: string }
  | { type: "reasoning"; text: string }
  | { role: "system" | "user" | "assistant"; content: string }; // legacy shape backward compat

export interface ThreadState {
  id: string;
  sessionId: string;
  objectUri: string;
  messages: ThreadMessage[];
  status: string;
  ticks: number;
  maxTicks: number;
  lastError?: string;
}

export interface ThreadResponse {
  ok: boolean;
  source: "memory" | "disk";
  thread: ThreadState;
}

export function getThread(
  sessionId: string,
  objectName: string,
  threadId: string,
): Promise<ThreadResponse> {
  return req<ThreadResponse>(
    `/api/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectName)}/threads/${encodeURIComponent(threadId)}`,
  );
}

/* -------- talk -------- */

export interface TalkInput {
  target: string;
  content: string;
  sessionId?: string;
}

export interface TalkResponse {
  ok: boolean;
  sessionId: string;
  threadId: string;
  response: string;
  threadStatus: string;
}

export function talkTo(input: TalkInput): Promise<TalkResponse> {
  return req<TalkResponse>("/api/talk", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* -------- file tree -------- */

export interface TreeEntry {
  name: string;
  type: "file" | "dir";
}

export interface TreeResponse {
  ok: boolean;
  path: string;
  entries: TreeEntry[];
}

export function getTree(path?: string): Promise<TreeResponse> {
  return req<TreeResponse>(`/api/tree${qs({ path })}`);
}

/* -------- file read -------- */

export interface FileContent {
  ok: boolean;
  content: string;
  bytes: number;
  truncated?: boolean;
}

export function readFile(path: string): Promise<FileContent> {
  return req<FileContent>(`/api/file/read${qs({ path })}`);
}
