/**
 * API 客户端 —— 与后端 HTTP API 通信
 *
 * @ref src/server/server.ts — references — 后端 HTTP API 端点
 * @ref .ooc/web/src/api/types.ts — references — 请求/响应类型定义
 */
import type {
  ObjectSummary,
  StoneData,
  FlowSummary,
  FlowData,
  TraitInfo,
  FileInfo,
  FileTreeNode,
  SSEEvent,
} from "./types";

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "请求失败");
  return json.data as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "请求失败");
  return json.data as T;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "请求失败");
  return json.data as T;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "请求失败");
  return json.data as T;
}

/** 列出所有对象 */
export async function fetchObjects(): Promise<ObjectSummary[]> {
  return get<ObjectSummary[]>("/stones");
}

/** 获取对象详情 */
export async function fetchObject(name: string): Promise<StoneData> {
  return get<StoneData>(`/stones/${name}`);
}

/** 获取对象 readme */
export async function fetchReadme(name: string): Promise<string> {
  const data = await get<{ content: string }>(`/stones/${name}/readme`);
  return data.content;
}

/** 获取对象 traits */
export async function fetchTraits(name: string): Promise<{ traits: TraitInfo[]; kernelTraits: TraitInfo[] }> {
  return get<{ traits: TraitInfo[]; kernelTraits: TraitInfo[] }>(`/stones/${name}/traits`);
}

/** 获取 sessions 列表 */
export async function fetchSessions(): Promise<FlowSummary[]> {
  const data = await get<{ sessions: FlowSummary[] }>("/flows");
  return data.sessions;
}

/** 分组配置类型 */
export interface GroupConfig {
  groups: Array<{
    groupName: string;
    members: Array<{ memberId: string; description?: string }>;
  }>;
}

/** 获取 sessions 分组配置 */
export async function fetchFlowGroups(): Promise<GroupConfig> {
  return get<GroupConfig>("/flows/groups");
}

/** 获取 stones 分组配置 */
export async function fetchStoneGroups(): Promise<GroupConfig> {
  return get<GroupConfig>("/stones/groups");
}

/** 获取单个 Flow 详情 */
export async function fetchFlow(sessionId: string): Promise<FlowData> {
  const data = await get<{ flow: FlowData; subFlows?: FlowData["subFlows"] }>(`/flows/${sessionId}`);
  return { ...data.flow, subFlows: data.subFlows };
}

/** 更新 Flow 标题 */
export async function updateFlowTitle(sessionId: string, title: string): Promise<FlowData> {
  const data = await patch<{ flow: FlowData }>(`/flows/${sessionId}`, { title });
  return data.flow;
}

/** 更新 session title（写入 .session.json） */
export async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  await patch<Record<string, unknown>>(`/sessions/${sessionId}`, { title });
}

/** 创建对象 */
export async function createObject(name: string, whoAmI: string): Promise<StoneData> {
  return post<StoneData>("/stones", { name, whoAmI });
}

/** 向对象发消息（可选 flowId 续写已有对话） */
/** 预创建 session，立即返回 sessionId */
export async function createSession(objectName = "supervisor"): Promise<{ sessionId: string }> {
  return post<{ sessionId: string }>("/sessions/create", { objectName });
}

export async function talkTo(objectName: string, message: string, flowId?: string): Promise<{
  sessionId: string;
  status: string;
  actions: unknown[];
  messages: unknown[];
}> {
  return post(`/talk/${objectName}`, { message, ...(flowId && { flowId }) });
}

/** 暂停对象执行 */
export async function pauseObject(name: string): Promise<{ name: string; paused: boolean }> {
  return post(`/stones/${name}/pause`, {});
}

/** 恢复暂停的 Flow */
export async function resumeFlow(name: string, flowId: string): Promise<{
  sessionId: string;
  status: string;
  actions: unknown[];
  messages: unknown[];
}> {
  return post(`/stones/${name}/resume`, { flowId });
}

/** 列出对象的 files 文件 */
export async function fetchFiles(name: string): Promise<FileInfo[]> {
  const data = await get<{ files: FileInfo[] }>(`/stones/${name}/files`);
  return data.files;
}

/** 读取单个 files 文件内容 */
export async function fetchFile(name: string, filename: string): Promise<string> {
  const data = await get<{ name: string; content: string }>(`/stones/${name}/files/${encodeURIComponent(filename)}`);
  return data.content;
}

/** 解析 ooc:// URL */
export async function resolveOocUrl(url: string): Promise<{ type: string; [key: string]: unknown }> {
  return get<{ type: string; [key: string]: unknown }>(`/resolve?url=${encodeURIComponent(url)}`);
}

/** 获取 .ooc/ 根目录文件树 */
export async function fetchProjectTree(): Promise<FileTreeNode> {
  return get<FileTreeNode>("/tree");
}

/** 读取 .ooc/ 下指定相对路径的文件内容 */
export async function fetchFileContent(path: string): Promise<string> {
  const data = await get<{ path: string; content: string; size: number }>(`/tree/file?path=${encodeURIComponent(path)}`);
  return data.content;
}

/** 写入 .ooc/ 下指定相对路径的文件内容 */
export async function saveFileContent(path: string, content: string): Promise<void> {
  await put<{ path: string }>("/tree/file", { path, content });
}

/** 获取指定 session 目录的文件树 */
export async function fetchSessionTree(sessionId: string): Promise<FileTreeNode> {
  return get<FileTreeNode>(`/flows/${sessionId}/tree`);
}

/** 获取指定 stone 目录的文件树 */
export async function fetchStoneTree(name: string): Promise<FileTreeNode> {
  return get<FileTreeNode>(`/stones/${name}/tree`);
}

/** 更新线程图钉 */
export async function updateThreadPins(
  sessionId: string,
  threadId: string,
  pins: string[],
  objectName = "supervisor",
): Promise<void> {
  await put(`/flows/${sessionId}/threads/${threadId}/pins`, { pins, objectName });
}

/**
 * SSE 端点地址
 *
 * 开发模式下 Vite proxy 会 buffer SSE 流导致事件延迟，
 * 因此直连后端。后端已配置 CORS，不会有跨域问题。
 */
const SSE_URL = `${BASE}/sse`;

/** 创建 SSE 连接 */
export function connectSSE(onEvent: (event: SSEEvent) => void): () => void {
  const source = new EventSource(SSE_URL);

  source.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data) as SSEEvent;
      onEvent(event);
    } catch {
      /* 忽略解析失败 */
    }
  };

  source.onerror = () => {
    /* EventSource 会自动重连 */
  };

  return () => source.close();
}
