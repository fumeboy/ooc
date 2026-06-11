import { readLlmEnv } from "./env";
import { generateWithClaude, streamWithClaude } from "./providers/claude";
import { generateWithOpenAi, streamWithOpenAi } from "./providers/openai";
import { resolveLlmTimeoutMs, withLlmTimeout } from "./timeout";
import type { LlmClient, LlmGenerateParams } from "./types";

// 统一 client 负责解析默认配置，并把 provider 差异挡在内部。
export function createLlmClient(): LlmClient {
  return {
    // generate 先按 provider 分发，保持代码路径直接清晰。
    // 外层包 withLlmTimeout 兜底: 任何 provider hang 都会在超时后抛 LlmTimeoutError,
    // 避免 scheduler tick 永远卡住 (见 src/thinkable/llm/timeout.ts)。
    // 超时取值优先级: params.timeoutMs (任务级) > OOC_LLM_TIMEOUT_MS > 120s 默认。
    async generate(params) {
      const config = readLlmEnv();
      const provider = params.provider ?? config.provider;
      const merged = { ...params, provider } satisfies LlmGenerateParams;

      const timeoutMs = resolveLlmTimeoutMs(params.timeoutMs);
      const inner = provider === "openai"
        ? generateWithOpenAi({ ...config, provider }, merged)
        : generateWithClaude({ ...config, provider }, merged);

      return withLlmTimeout(inner, timeoutMs);
    },

    // stream 同样由统一门面分发到底层适配器。
    stream(params) {
      const config = readLlmEnv();
      const provider = params.provider ?? config.provider;
      const merged = { ...params, provider } satisfies LlmGenerateParams;

      if (provider === "openai") {
        return streamWithOpenAi({ ...config, provider }, merged);
      }

      return streamWithClaude({ ...config, provider }, merged);
    }
  };
}
