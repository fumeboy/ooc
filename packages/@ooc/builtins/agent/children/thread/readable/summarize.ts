import { ThreadContext } from "../types";

export async function summarize(thread: ThreadContext): Promise<{summary: string, summarizedMessageIndex: number}> {
  // TODO: 创建 sub thread 请求 LLM 进行总结
  return { summary: "", summarizedMessageIndex: 0 };
}
