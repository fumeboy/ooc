export { createLlmClient } from "./client";
export { readLlmEnv } from "./env";
export { LlmTimeoutError, readLlmTimeoutMs, withLlmTimeout } from "./timeout";

/** 对外统一导出 LLM 抽象类型，避免调用方依赖 provider 适配器目录。 */
export type {
  LlmClient,
  LlmEnvConfig,
  LlmGenerateParams,
  LlmGenerateResult,
  LlmMessage,
  LlmProvider,
  LlmStreamEvent,
  LlmTool,
  LlmToolCall,
  LlmToolName
} from "./types";
