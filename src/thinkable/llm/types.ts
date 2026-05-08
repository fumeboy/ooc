// LLM provider 只保留首批需要的两种协议，避免过早抽象。
export type LlmProvider = "openai" | "claude";

// thinkloop 当前文档只定义了 6 个 tool，这里不提前开放任意字符串。
export type LlmToolName = "open" | "refine" | "submit" | "close" | "wait" | "compress";

// 统一消息结构先只支持纯文本，后续再扩展多模态。
export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// tool 定义直接给 provider 使用，不额外引入复杂 schema 框架。
export type LlmTool = {
  name: LlmToolName;
  description: string;
  inputSchema: Record<string, unknown>;
};

// 统一 tool call 结果，供 thinkloop 直接消费。
export type LlmToolCall = {
  id: string;
  name: LlmToolName;
  arguments: Record<string, unknown>;
};

// 统一请求参数由上层传入，provider 与 model 允许按次覆盖默认值。
export type LlmGenerateParams = {
  provider?: LlmProvider;
  model?: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  temperature?: number;
  maxTokens?: number;
};

// 非流式结果保留文本、toolCalls 与调试字段，避免拆成第三种入口。
export type LlmGenerateResult = {
  provider: LlmProvider;
  model: string;
  text: string;
  toolCalls: LlmToolCall[];
  thinking?: string;
  raw?: unknown;
};

// 流式事件统一成开始、thinking、文本、tool-call 与结束五类事件。
export type LlmStreamEvent =
  | { type: "start"; provider: LlmProvider; model: string }
  | { type: "thinking-delta"; text: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolCall: LlmToolCall }
  | {
      type: "done";
      text: string;
      toolCalls: LlmToolCall[];
      thinking?: string;
      raw?: unknown;
    };

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
