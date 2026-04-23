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
  Process,
  ContextVisibilityResult,
  UserInbox,
  FormResponse,
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

/** 获取 session 中的所有对象列表 */
export async function fetchSessionObjects(sessionId: string): Promise<string[]> {
  return get<string[]>(`/sessions/${sessionId}/objects`);
}

/** 获取对象的 process 数据 */
export async function fetchObjectProcess(
  sessionId: string,
  objectName: string
): Promise<Process> {
  return get<Process>(`/sessions/${sessionId}/objects/${objectName}/process`);
}

/**
 * 获取线程树每个节点相对于 focus 的 Context 可见性分类
 *
 * @param sessionId - Flow session ID
 * @param objectName - Object 名称
 * @param focus - 观察主体线程 ID（可选，后端会默认选 running 叶节点或 root）
 */
export async function getContextVisibility(
  sessionId: string,
  objectName: string,
  focus?: string,
): Promise<ContextVisibilityResult> {
  const query = focus ? `?focus=${encodeURIComponent(focus)}` : "";
  return get<ContextVisibilityResult>(
    `/flows/${sessionId}/objects/${objectName}/context-visibility${query}`,
  );
}

/**
 * 获取 session 的 user inbox（引用式收件箱）
 *
 * 返回条目只包含 (threadId, messageId) 引用——消息正文请在发起对象的
 * threads/{threadId}/thread.json 的 actions[] 里按 id === messageId 反查。
 *
 * @param sessionId - Flow session ID
 * @ref docs/工程管理/迭代/all/20260421_feature_user_inbox.md
 */
export async function getUserInbox(sessionId: string): Promise<UserInbox> {
  return get<UserInbox>(`/sessions/${sessionId}/user-inbox`);
}

/**
 * 更新 user 对某对象的已读进度（timestamp 为该对象线程中已读到的最大消息时间戳）
 *
 * 服务端以 objectName 为 key 单调递增地记录；旧 timestamp 会被忽略。
 *
 * @param sessionId - Flow session ID
 * @param objectName - 对象名（如 "bruce"）
 * @param timestamp - 已读的最大消息 timestamp（epoch ms）
 * @ref docs/工程管理/迭代/all/20260421_feature_user_inbox_read_state.md
 */
export async function setUserReadObject(
  sessionId: string,
  objectName: string,
  timestamp: number,
): Promise<{ readState: { lastReadTimestampByObject: Record<string, number> } }> {
  return post<{ readState: { lastReadTimestampByObject: Record<string, number> } }>(
    `/sessions/${sessionId}/user-read-state`,
    { objectName, timestamp },
  );
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

/**
 * 向对象发消息
 *
 * @param objectName 目标对象名
 * @param message 消息正文（若同时带 formResponse，服务端会把结构化信息作为
 *   [formResponse] 前缀注入 message 正文）
 * @param flowId 可选，续写已有 session；不传则后端生成新 sessionId
 * @param formResponse 可选，对某个 form 的结构化回复（用户点选 + 自由文本）
 */
export async function talkTo(
  objectName: string,
  message: string,
  flowId?: string,
  formResponse?: FormResponse,
): Promise<{
  sessionId: string;
  status: string;
  actions: unknown[];
  messages: unknown[];
}> {
  return post(`/talk/${objectName}`, {
    message,
    ...(flowId && { flowId }),
    ...(formResponse && { formResponse }),
  });
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

/**
 * 调用对象 View 的 ui_method（Phase 4）
 *
 * 后端白名单严格：traitId 必须 self: + trait kind=view + method 在 ui_methods。
 * 若方法调用 ctx.notifyThread，会写入根线程 inbox 并（必要时）复活 done 线程。
 *
 * @param sessionId - flow 所属 session id
 * @param objectName - 对象名（必须是 view 的所有者）
 * @param traitId - self:{viewName} 格式
 * @param method - ui_methods 中声明的方法名
 * @param args - 方法参数（对象）
 * @returns 方法返回值
 *
 * @ref docs/superpowers/specs/2026-04-21-trait-namespace-views-and-http-methods-design.md#4.7
 */
export async function callMethod<TResult = unknown>(
  sessionId: string,
  objectName: string,
  traitId: string,
  method: string,
  args: object = {},
): Promise<TResult> {
  const body = await post<{ result: TResult }>(
    `/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectName)}/call_method`,
    { traitId, method, args },
  );
  return body.result;
}

/* ========== Edit Plans（多文件原子编辑事务） ==========
 *
 * LLM 通过 plan_edits 在后端创建 plan（不真写），前端可以：
 *   1. GET 拉取 plan 详情 + unified diff preview
 *   2. POST .../apply 应用事务
 *   3. POST .../cancel 取消 pending plan
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_edit_plans_http_ui.md
 */

/** plan 最小字段（与后端 EditPlan 结构对齐） */
export interface EditPlanData {
  planId: string;
  sessionId?: string;
  createdAt: number;
  status: "pending" | "applied" | "failed" | "cancelled";
  rootDir: string;
  changes: Array<{
    kind: "edit" | "write";
    path: string;
    oldText?: string;
    newText?: string;
    newContent?: string;
    replaceAll?: boolean;
  }>;
  appliedAt?: number;
  applyResult?: {
    ok: boolean;
    applied: number;
    error?: string;
    perChange: Array<{
      path: string;
      ok: boolean;
      bytesWritten?: number;
      error?: string;
      before?: string;
      after?: string;
    }>;
  };
}

/** apply 返回 */
export interface ApplyEditPlanResponse {
  result: {
    ok: boolean;
    applied: number;
    error?: string;
    perChange: Array<{
      path: string;
      ok: boolean;
      bytesWritten?: number;
      error?: string;
      before?: string;
      after?: string;
    }>;
  };
  plan: EditPlanData;
}

/** 读取 plan + unified diff preview */
export async function getEditPlan(
  sessionId: string,
  planId: string,
): Promise<{ plan: EditPlanData; preview: string }> {
  return get<{ plan: EditPlanData; preview: string }>(
    `/flows/${encodeURIComponent(sessionId)}/edit-plans/${encodeURIComponent(planId)}`,
  );
}

/** 应用 plan。threadId 可选，用于让 build hook feedback 落到对应线程 bucket */
export async function applyEditPlan(
  sessionId: string,
  planId: string,
  threadId?: string,
): Promise<ApplyEditPlanResponse> {
  return post<ApplyEditPlanResponse>(
    `/flows/${encodeURIComponent(sessionId)}/edit-plans/${encodeURIComponent(planId)}/apply`,
    threadId ? { threadId } : {},
  );
}

/** 取消 pending plan */
export async function cancelEditPlan(
  sessionId: string,
  planId: string,
): Promise<{ plan: EditPlanData }> {
  return post<{ plan: EditPlanData }>(
    `/flows/${encodeURIComponent(sessionId)}/edit-plans/${encodeURIComponent(planId)}/cancel`,
    {},
  );
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
 * 开发模式下（vite dev server 5173）Vite 的 HTTP proxy 在某些路径下
 * 会让 EventSource 长连接 stuck（已开发现：第二次新 session 后只能收到
 * flow:start 一个事件，后续 stream:* / flow:action / flow:message 全部
 * 收不到，必须刷新页面才能拿到最新数据）。
 *
 * 因此 dev 模式直连后端 8080（后端已配 CORS_HEADERS = *）。
 * 生产 / 反向代理（nginx）模式下走相对路径，由网关负责正确转发 SSE
 * （需 `proxy_buffering off`）。
 *
 * @ref docs/工程管理/迭代/all/20260422_bugfix_新session_sse实时性.md
 */
function resolveSseUrl(): string {
  /* 仅当前页面在标准 vite dev port 时才认为是 dev，避免误命中生产部署 */
  if (typeof window !== "undefined" && window.location?.port === "5173") {
    /* dev：直连后端 8080。同 host 即可（CORS 允许 *）。 */
    return `${window.location.protocol}//${window.location.hostname}:8080${BASE}/sse`;
  }
  return `${BASE}/sse`;
}

/** 创建 SSE 连接 */
export function connectSSE(onEvent: (event: SSEEvent) => void): () => void {
  const source = new EventSource(resolveSseUrl());

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

/* ========== Debug 模式 ========== */

export async function enableDebug(): Promise<{ debugEnabled: boolean }> {
  return post("/debug/enable", {});
}

export async function disableDebug(): Promise<{ debugEnabled: boolean }> {
  return post("/debug/disable", {});
}

export async function getDebugStatus(): Promise<{ debugEnabled: boolean }> {
  return get("/debug/status");
}

/* ========== 全局暂停 ========== */

export async function enableGlobalPause(): Promise<{ globalPaused: boolean }> {
  return post("/global-pause/enable", {});
}

export async function disableGlobalPause(): Promise<{ globalPaused: boolean }> {
  return post("/global-pause/disable", {});
}

export async function getGlobalPauseStatus(): Promise<{ globalPaused: boolean }> {
  return get("/global-pause/status");
}
