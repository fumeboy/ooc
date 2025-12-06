/**
 * API 客户端
 * 封装所有与后端的 HTTP 请求
 */

import type {
  Session,
  CreateSessionRequest,
  CreateSessionResponse,
  ListSessionsResponse,
  Conversation,
  ListConversationsResponse,
  Info,
  ListInfosResponse,
  AskRequest,
  SetPossessRequest,
  SetPossessResponse,
  GetPossessRequestResponse,
  RespondPossessRequest,
  TalkRequest,
  TalkResponse,
  RespondManualThinkRequest,
  GetWaitingManualConversationsResponse,
  ContinueConversationRequest,
  ConfigResponse,
} from '../types/api';

const API_BASE = '/api';

/**
 * 通用请求函数
 */
async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  // 读取响应文本
  const text = await response.text();
  
  // 如果响应为空，返回空对象（对于 void 类型的响应）
  if (!text || text.trim() === '') {
    return {} as T;
  }

  // 尝试解析 JSON
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    // 如果解析失败，返回空对象
    console.warn('Failed to parse JSON response:', e);
    return {} as T;
  }
}

// ========== Session API ==========

export const sessionApi = {
  /**
   * 创建新的 Session
   */
  create: (data: CreateSessionRequest): Promise<CreateSessionResponse> => {
    return request<CreateSessionResponse>('/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * 获取所有 Session 列表
   */
  list: (): Promise<ListSessionsResponse> => {
    return request<ListSessionsResponse>('/sessions');
  },

  /**
   * 获取 Session 详情
   */
  get: (id: string): Promise<Session> => {
    return request<Session>(`/sessions/${id}`);
  },
};

// ========== Conversation API ==========

export const conversationApi = {
  /**
   * 获取 Session 的所有 Conversation 列表
   */
  list: (sessionId: string): Promise<ListConversationsResponse> => {
    return request<ListConversationsResponse>(`/sessions/${sessionId}/conversations`);
  },

  /**
   * 获取 Conversation 详情
   */
  get: (sessionId: string, conversationId: string): Promise<Conversation> => {
    return request<Conversation>(`/sessions/${sessionId}/conversations/${conversationId}`);
  },

  /**
   * 回答 Ask 问题
   */
  answerAsk: (sessionId: string, data: AskRequest): Promise<void> => {
    return request<void>(`/sessions/${sessionId}/answer`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ========== Info API ==========

export const infoApi = {
  /**
   * 获取所有 Info 列表
   */
  list: (sessionId: string): Promise<ListInfosResponse> => {
    return request<ListInfosResponse>(`/sessions/${sessionId}/infos`);
  },

  /**
   * 获取 Info 详情
   * @param detail 是否获取详细信息（prompt 和 methods），默认为 false
   */
  get: (sessionId: string, infoId: string, detail: boolean = false): Promise<Info> => {
    const url = detail 
      ? `/sessions/${sessionId}/info/${infoId}?detail=true`
      : `/sessions/${sessionId}/info/${infoId}`;
    return request<Info>(url);
  },
};

// ========== Talk API ==========

export const talkApi = {
  /**
   * 用户发起 Talk
   */
  talk: (sessionId: string, data: TalkRequest): Promise<TalkResponse> => {
    return request<TalkResponse>(`/sessions/${sessionId}/talk`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ========== Manual Think API ==========

export const manualThinkApi = {
  /**
   * 获取等待手动思考的 conversations
   */
  getWaitingManualConversations: (sessionId: string): Promise<GetWaitingManualConversationsResponse> => {
    return request<GetWaitingManualConversationsResponse>(`/sessions/${sessionId}/waiting_manual_conversations`);
  },

  /**
   * 回复手动思考请求
   */
  respond: (sessionId: string, data: RespondManualThinkRequest): Promise<void> => {
    return request<void>(`/sessions/${sessionId}/manual_think`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ========== Possess API ==========

export const possessApi = {
  /**
   * 设置附身状态
   */
  setPossess: (sessionId: string, data: SetPossessRequest): Promise<SetPossessResponse> => {
    return request<SetPossessResponse>(`/sessions/${sessionId}/possess`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * 获取当前的附身请求（已废弃，使用 manualThinkApi.getWaitingManualConversations）
   */
  getRequest: (sessionId: string): Promise<GetPossessRequestResponse> => {
    return request<GetPossessRequestResponse>(`/sessions/${sessionId}/possess/request`);
  },

  /**
   * 回复附身请求（已废弃，使用 manualThinkApi.respond）
   */
  respond: (sessionId: string, data: RespondPossessRequest): Promise<void> => {
    return request<void>(`/sessions/${sessionId}/possess/respond`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ========== Continue Conversation API ==========

export const continueApi = {
  /**
   * 继续对话
   */
  continue: (sessionId: string, data: ContinueConversationRequest): Promise<void> => {
    return request<void>(`/sessions/${sessionId}/continue`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ========== Config API ==========

export const configApi = {
  /**
   * 获取系统配置
   */
  get: (): Promise<ConfigResponse> => {
    return request<ConfigResponse>('/conf');
  },
};

