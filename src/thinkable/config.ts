/**
 * LLM 配置加载
 *
 * 从环境变量读取配置，不在源码中硬编码密钥。
 */

export interface LLMConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  timeout: number;
  thinking?: ThinkingConfig;
}

export interface ThinkingConfig {
  enabled: boolean;
  mode?: string;
  budget?: number;
}

/**
 * 默认配置（从环境变量读取）
 *
 * 需要设置以下环境变量（或在 .env 文件中配置）：
 * - OOC_API_KEY: LLM API 密钥
 * - OOC_BASE_URL: API 基础 URL（可选）
 * - OOC_MODEL: 模型名称（可选）
 */
export function DefaultConfig(): LLMConfig {
  const apiKey = process.env.OOC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "缺少 OOC_API_KEY 环境变量。请在 .env 文件中配置或设置环境变量。",
    );
  }

  const thinkingBudget = process.env.OOC_THINKING_BUDGET;

  return {
    provider: "openai-compatible",
    apiKey,
    baseUrl: process.env.OOC_BASE_URL || "https://api.openai.com/v1/",
    model: process.env.OOC_MODEL || "gpt-4o",
    maxTokens: 40*10000,
    timeout: 300,
    thinking: {
      enabled: process.env.OOC_THINKING_ENABLED === "1",
      mode: process.env.OOC_THINKING_MODE || undefined,
      budget: thinkingBudget ? Number(thinkingBudget) : undefined,
    },
  };
}
