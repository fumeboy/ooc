// 本文件定义后端 HTTP API 的请求/响应类型，便于前端统一引用。

export interface SessionListItem {
  id: string
  status: string
  created_at: string
  updated_at: string
  possessed: boolean
}

export interface ListSessionsResponse {
  sessions: SessionListItem[]
}

export interface CreateSessionRequest {
  user_request: string
  references?: string[]
  possess?: boolean
}

export interface CreateSessionResponse {
  session_id: string
  status: string
}

export interface GetSessionResponse {
  id: string
  status: string
  created_at: string
  updated_at: string
  possessed: boolean
}

export interface TalkRequest {
  talk_with: string
  title?: string
  content: string
  references?: Record<string, string>
}

export interface TalkResponse {
  conversation_id: string
}

export interface CommonParamsResponse {
  title?: string
  content?: string
  references?: Record<string, string>
}

export interface QuestionResponse {
  id: number
  question: CommonParamsResponse
  answer: CommonParamsResponse
}

export interface ActivityResponse {
  typ: 'talk' | 'act' | 'ask' | 'focus'
  conversation_id?: string
  object?: string
  method?: string
  request?: unknown
  response?: CommonParamsResponse
  question_id?: number
}

export interface ManualThinkRequestResponse {
  conversation_id: string
  prompt?: string
  tools?: string[]
  llm_method?: string
  llm_params?: unknown
}

export interface ConversationResponse {
  id: string
  from: string
  to: string
  title?: string
  desc?: string
  request: CommonParamsResponse
  response: CommonParamsResponse
  questions: QuestionResponse[]
  activities: ActivityResponse[]
  status: string
  error?: string
  mode?: string
  waiting_manual_think_request?: ManualThinkRequestResponse
  updated_at: string
}

export interface ListConversationsResponse {
  conversations: ConversationResponse[]
}

export interface GetWaitingManualConversationsResponse {
  conversations: ConversationResponse[]
}

export interface InfoListItem {
  id: string
  name: string
  description: string
  class: string
}

export interface ListInfosResponse {
  infos: InfoListItem[]
}

export interface InfoResponse {
  id: string
  name: string
  description: string
  prompt?: string
  methods?: string[]
  class?: string
}

export interface SetPossessRequest {
  possess: boolean
}

export interface SetPossessResponse {
  possessed: boolean
}

export interface AnswerRequest {
  conversation_id: string
  question_id: number
  answer: string
  references?: Record<string, string>
}

export interface ManualThinkRequestPayload {
  conversation_id: string
  method: string
  parameters: unknown
}

export interface ApiError extends Error {
  status?: number
}

