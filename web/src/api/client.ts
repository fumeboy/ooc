// HTTP 适配层：封装与 /api 后端的交互，提供类型安全的请求函数。
import type {
  AnswerRequest,
  ConversationResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  GetSessionResponse,
  InfoResponse,
  ListConversationsResponse,
  ListInfosResponse,
  ListSessionsResponse,
  ManualThinkRequestPayload,
  SetPossessResponse,
  TalkRequest,
  TalkResponse,
  GetWaitingManualConversationsResponse,
  ApiError,
} from '../types/api'

const DEFAULT_TIMEOUT = 10_000

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT)

  try {
    const res = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })

    if (!res.ok) {
      const err: ApiError = new Error(res.statusText || 'Request failed')
      err.status = res.status
      throw err
    }

    const contentType = res.headers.get('Content-Type') || ''
    if (contentType.includes('application/json')) {
      return (await res.json()) as T
    }
    // 某些接口返回空字符串，例如 Answer/RespondManualThink
    const text = await res.text()
    return text as unknown as T
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      const err: ApiError = new Error('Request timed out')
      err.status = 408
      throw err
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export function createSession(body: CreateSessionRequest) {
  return request<CreateSessionResponse>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function listSessions() {
  return request<ListSessionsResponse>('/api/sessions', { method: 'GET' })
}

export function getSession(sessionId: string) {
  return request<GetSessionResponse>(`/api/sessions/${sessionId}`, { method: 'GET' })
}

export function talk(sessionId: string, body: TalkRequest) {
  return request<TalkResponse>(`/api/sessions/${sessionId}/talk`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function answer(sessionId: string, body: AnswerRequest) {
  return request<string>(`/api/sessions/${sessionId}/answer`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function listConversations(sessionId: string) {
  return request<ListConversationsResponse>(`/api/sessions/${sessionId}/conversations`, { method: 'GET' })
}

export function getConversation(sessionId: string, conversationId: string) {
  return request<ConversationResponse>(`/api/sessions/${sessionId}/conversations/${conversationId}`, { method: 'GET' })
}

export function listInfos(sessionId: string) {
  return request<ListInfosResponse>(`/api/sessions/${sessionId}/infos`, { method: 'GET' })
}

export function getInfo(sessionId: string, infoId: string, detail = true) {
  const suffix = detail ? '?detail=true' : ''
  return request<InfoResponse>(`/api/sessions/${sessionId}/info/${infoId}${suffix}`, { method: 'GET' })
}

export function setPossess(sessionId: string, possess: boolean) {
  return request<SetPossessResponse>(`/api/sessions/${sessionId}/possess`, {
    method: 'POST',
    body: JSON.stringify({ possess }),
  })
}

export function getWaitingManualConversations(sessionId: string) {
  return request<GetWaitingManualConversationsResponse>(
    `/api/sessions/${sessionId}/waiting_manual_conversations`,
    { method: 'GET' }
  )
}

export function respondManualThink(sessionId: string, payload: ManualThinkRequestPayload) {
  return request<string>(`/api/sessions/${sessionId}/manual_think`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getConfig() {
  return request<Record<string, unknown>>('/api/conf', { method: 'GET' })
}

