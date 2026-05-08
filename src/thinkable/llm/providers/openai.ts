import type {
  LlmEnvConfig,
  LlmGenerateParams,
  LlmGenerateResult,
  LlmStreamEvent
} from "../types";

// OpenAI 非流式请求直接走 chat completions，返回统一结果。
export async function generateWithOpenAi(
  config: LlmEnvConfig,
  params: LlmGenerateParams
): Promise<LlmGenerateResult> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: params.model ?? config.model,
      messages: params.messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: false
    })
  });

  // HTTP 层失败时直接抛错，不做额外兜底分支。
  if (!response.ok) {
    throw new Error(`OpenAI 请求失败: ${response.status}`);
  }

  // 首批只提取最终文本内容，并把原始响应保留给调试场景。
  const raw = await response.json();
  const text = raw.choices?.[0]?.message?.content ?? "";

  return {
    provider: "openai",
    model: params.model ?? config.model,
    text,
    raw
  };
}

// OpenAI 流式路径把 SSE 增量归一化成统一事件。
export async function* streamWithOpenAi(
  config: LlmEnvConfig,
  params: LlmGenerateParams
): AsyncIterable<LlmStreamEvent> {
  const model = params.model ?? config.model;
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: params.messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: true
    })
  });

  // 流式请求需要同时确保状态码成功且存在响应体。
  if (!response.ok || !response.body) {
    throw new Error(`OpenAI 流式请求失败: ${response.status}`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let pending = "";
  let fullText = "";

  // 统一事件流总是先告诉上层本次请求已经开始。
  yield { type: "start", provider: "openai", model };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    // SSE 可能分片到多个 chunk，需要先拼接再按帧切分。
    pending += decoder.decode(value, { stream: true });
    const frames = pending.split("\n\n");
    pending = frames.pop() ?? "";

    for (const frame of frames) {
      if (!frame.startsWith("data: ")) {
        continue;
      }

      const payload = frame.slice(6);
      if (payload === "[DONE]") {
        continue;
      }

      // OpenAI 兼容流里，文本增量位于 choices[0].delta.content。
      const json = JSON.parse(payload);
      const delta = json.choices?.[0]?.delta?.content ?? "";

      if (!delta) {
        continue;
      }

      fullText += delta;
      yield { type: "text-delta", text: delta };
    }
  }

  // done 事件把完整文本交给上层，避免上层自行再聚合一遍。
  yield { type: "done", text: fullText, raw: undefined };
}
