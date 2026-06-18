/** LLM provider 只保留首批需要的两种协议，避免过早抽象。 */
export type LlmProvider = "openai" | "claude";

/** ThinkLoop 当前文档定义的 tool 原语名称；不提前开放任意字符串。 */
export type LlmToolName = "exec" | "close" | "wait";

/** provider 无关的最小文本消息结构。 */
export type LlmMessage = {
  /** LLM 协议角色；system 只承载稳定 context。 */
  role: "system" | "user" | "assistant";
  /** 纯文本内容；多模态内容不在本轮抽象范围内。 */
  content: string;
};

/** Responses-first 的统一输入 item；message 只是 item 的一种。 */
export type LlmInputItem =
  | {
      type: "message";
      role: "system" | "user" | "assistant";
      content: string;
    }
  | {
      type: "function_call";
      call_id: string;
      name: LlmToolName;
      arguments: Record<string, unknown>;
    }
  | {
      type: "function_call_output";
      call_id: string;
      name?: LlmToolName;
      output: string;
    }
  | {
      type: "reasoning";
      text: string;
    };

/** 可暴露给 provider 的 tool 定义。 */
export type LlmTool = {
  /** tool 原语名称，必须来自 OOC 文档定义的有限集合。 */
  name: LlmToolName;
  /** 给模型看的使用说明。 */
  description: string;
  /** provider 可消费的 JSON schema 形态参数定义。 */
  inputSchema: Record<string, unknown>;
};

/** provider 返回后归一化的 tool call。 */
export type LlmToolCall = {
  /** provider 侧或适配层生成的调用 ID。 */
  id: string;
  /** 被调用的 OOC tool 名称。 */
  name: LlmToolName;
  /** tool 参数对象；解析失败应在 provider 适配层处理。 */
  arguments: Record<string, unknown>;
};

/** 统一 LLM 请求参数。 */
export type LlmGenerateParams = {
  /** 可选 provider 覆盖；缺省时使用环境变量配置。 */
  provider?: LlmProvider;
  /** 可选模型覆盖；缺省时使用环境变量配置。 */
  model?: string;
  /** 本轮完整输入 items。 */
  input: LlmInputItem[];
  /** 可选的顶层 instructions。 */
  instructions?: string;
  /** 本轮可用工具；为空时 provider 不暴露 tool calling。 */
  tools?: LlmTool[];
  /** 采样温度，原样透传给 provider。 */
  temperature?: number;
  /** 最大输出 token，原样透传给 provider。 */
  maxTokens?: number;
  /**
   * 任务级 LLM 超时覆盖（ms）。
   *
   * 缺省时 createLlmClient.generate 回落全局默认（readLlmTimeoutMs：120s，
   * OOC_LLM_TIMEOUT_MS 可覆写）。由 thinkloop 从 thread.llmTimeoutMs 透传，
   * 让特定 thread 申请更长超时而不全局拔高。
   */
  timeoutMs?: number;
};

/** 非流式生成结果。 */
export type LlmGenerateResult = {
  /** 实际响应的 provider。 */
  provider: LlmProvider;
  /** 实际响应的模型名。 */
  model: string;
  /** provider 返回并归一化后的输出 items。 */
  outputItems: LlmInputItem[];
  /** provider 返回的文本正文。 */
  text: string;
  /** provider 返回并归一化后的 tool calls。 */
  toolCalls: LlmToolCall[];
  /** 可选 thinking 内容，只记录不自动复喂。 */
  thinking?: string;
  /** provider 原始响应，供调试使用，不作为业务接口依赖。 */
  raw?: unknown;
};

/** 从运行时环境变量解析出的标准 LLM 配置。 */
export type LlmEnvConfig = {
  /** 默认 provider。 */
  provider: LlmProvider;
  /** provider API key。 */
  apiKey: string;
  /** provider API base URL。 */
  baseUrl: string;
  /** 默认模型名。 */
  model: string;
};

/** LLM client 统一门面；调用方不直接依赖具体 provider。 */
export interface LlmClient {
  /** 执行一次非流式请求。 */
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult>;
}
