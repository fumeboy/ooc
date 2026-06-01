import type { LlmEnvConfig, LlmProvider } from "./types";

// 统一读取 OOC_* 配置，不支持 provider 专属覆盖层。
export function readLlmEnv(): LlmEnvConfig {
  const provider = (process.env.OOC_PROVIDER ?? "openai") as string;
  const apiKey = process.env.OOC_API_KEY;
  const baseUrl = process.env.OOC_BASE_URL;
  const model = process.env.OOC_MODEL;

  // 第一批只接受 openai / claude 两种协议，非法值直接抛错。
  if (provider !== "openai" && provider !== "claude") {
    throw new Error(`OOC_PROVIDER 无效: ${provider}`);
  }

  // 不做过度兜底，缺少关键字段时直接失败，保持逻辑直接。
  if (!apiKey) {
    throw new Error("缺少 OOC_API_KEY");
  }

  // baseUrl 是统一 client 的请求入口，没有它就不继续运行。
  if (!baseUrl) {
    throw new Error("缺少 OOC_BASE_URL");
  }

  // model 属于首批最小配置的一部分，这里直接要求显式提供。
  if (!model) {
    throw new Error("缺少 OOC_MODEL");
  }

  // 返回标准化配置对象，供统一 client 与 provider 共用。
  return {
    provider: provider as LlmProvider,
    apiKey,
    baseUrl,
    model
  };
}
