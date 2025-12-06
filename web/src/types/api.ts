/**
 * API 相关的 TypeScript 类型定义
 * 对应后端 server 包中的响应结构
 */

// ========== Session 相关 ==========

export interface Session {
  id: string;
  user_request: string;
  result: string;
  status: string;
  created_at: string;
  updated_at: string;
  possessed: boolean;
}

export interface SessionListItem {
  id: string;
  user_request: string;
  status: string;
  created_at: string;
  updated_at: string;
  possessed: boolean;
}

export interface CreateSessionRequest {
  user_request: string;
  references?: string[];
  possess?: boolean;
}

export interface CreateSessionResponse {
  session_id: string;
  status: string;
}

export interface ListSessionsResponse {
  sessions: SessionListItem[];
}

// ========== Conversation 相关 ==========

export interface ListConversationsResponse {
  conversations: Conversation[];
}

export interface CommonParams {
  title?: string;
  content?: string;
  references?: Record<string, string>;
}

export interface Question {
  id: number;
  question: CommonParams;
  answer: CommonParams;
}

export interface Action {
  typ: 'talk' | 'act';
  conversation_id?: string;
  object?: string;
  method?: string;
  request?: unknown;
  response?: CommonParams;
}

export interface Conversation {
  id: string;
  from: string;
  to: string;
  title?: string;
  desc?: string;
  request: CommonParams;
  response: CommonParams;
  questions: Question[];
  actions: Action[];
  status: string;
}

// ========== Info 相关 ==========

export interface Info {
  id: string;
  name: string;
  description: string;
  prompt?: string; // 可选，仅在 detail=true 时返回
  methods?: string[]; // 可选，仅在 detail=true 时返回
}

export interface InfoListItem {
  id: string;
  name: string;
  description: string;
  class: string;
}

export interface ListInfosResponse {
  infos: InfoListItem[];
}

// ========== Ask 相关 ==========

export interface AskRequest {
  conversation_id: string; // 对话 ID（多轮交互下需要指定）
  question_id: number;
  answer: string;
  references?: Record<string, string>;
}

// ========== Possess 相关 ==========

export interface StartPossessRequest {
  possess: boolean;
}

export interface StartPossessResponse {
  possessed: boolean;
}

export interface GetPossessRequestResponse {
  has_request: boolean;
  prompt?: string;
  tools?: string[];
  llm_method?: string; // LLM 输出的方法名
  llm_params?: unknown; // LLM 输出的参数（JSON 格式）
}

export interface RespondPossessRequest {
  method: string;
  parameters: unknown;
  references?: Record<string, string>; // key = info id, value = reason
  error?: string;
}

// ========== Continue Conversation 相关 ==========

export interface ContinueConversationRequest {
  content: string;
  title?: string;
  references?: Record<string, string>; // key = info id, value = reason
}

// ========== Config 相关 ==========

export interface AIConfig {
  provider: string;
  api_key: string;
  base_url: string;
  model: string;
  max_tokens: number;
  timeout: number;
}

export interface ConfigResponse {
  ai: AIConfig;
}

