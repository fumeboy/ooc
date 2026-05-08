// LLM provider 只保留首批需要的两种协议，避免过早抽象。
export type LlmProvider = "openai" | "claude";

// 统一消息结构先只支持纯文本，后续再扩展多模态。
export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// 统一请求参数由上层传入，provider 与 model 允许按次覆盖默认值。
export type LlmGenerateParams = {
  provider?: LlmProvider;
  model?: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
};

// 非流式结果只保留首批需要的最终文本和调试字段。
export type LlmGenerateResult = {
  provider: LlmProvider;
  model: string;
  text: string;
  raw?: unknown;
};

// 流式事件统一成开始、文本增量、结束三种事件。
export type LlmStreamEvent =
  | { type: "start"; provider: LlmProvider; model: string }
  | { type: "text-delta"; text: string }
  | { type: "done"; text: string; raw?: unknown };

// 运行时环境变量会被解析为标准配置，供 client 和 provider 共用。
export type LlmEnvConfig = {
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
};

// 统一门面的最小接口只暴露 generate 与 stream。
export interface LlmClient {
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult>;
  stream(params: LlmGenerateParams): AsyncIterable<LlmStreamEvent>;
}
