/**
 * ThinkLoop: 单轮 LLM 执行器。
 *
 * 负责编排一轮 LLM 调用：
 * 1. 检查 thread 状态（只处理 running）
 * 2. 调用 LlmClient.generate（使用 thread.messages 作为 input）
 * 3. 把 LLM 回复追加到 thread.messages
 * 4. 若 LLM 返回 text 且没有 tool call → 追加 assistant 消息并视为 done
 * 5. ticks++ 到达 maxTicks → status=done
 * 6. 错误 → status=failed + lastError
 *
 * 注意：P6 thinkloop 不处理 tool call dispatch——没有连接 dispatcher。
 * Object method dispatch（exec tool）留待 P7 连接。此轮只让 LLM 跑起来并记录结果。
 */

import type { LlmClient } from "./llm/types";
import type { ThinkThread } from "./think-thread";

/**
 * 执行 thread 的一轮 think。
 *
 * 副作用：修改 thread.messages / thread.status / thread.ticks / thread.lastError。
 * 调用方负责持久化（如有需要）。
 */
export async function think(thread: ThinkThread, llmClient: LlmClient): Promise<void> {
    if (thread.status !== "running") {
        throw new Error(`think: thread ${thread.id} status=${thread.status}, expected running`);
    }

    try {
        const result = await llmClient.generate({
            input: thread.messages.map((m) => ({
                type: "message" as const,
                role: m.role,
                content: m.content,
            })),
            timeoutMs: thread.llmTimeoutMs,
        });

        // 追加 LLM 文本回复到 messages
        if (result.text) {
            thread.messages = [
                ...thread.messages,
                { role: "assistant", content: result.text },
            ];
        }

        thread.ticks += 1;

        // 无 tool call 且有文本 → 视为对话结束
        if (result.toolCalls.length === 0) {
            thread.status = "done";
            return;
        }

        // P6: tool call 存在时暂不 dispatch，记录后继续（P7 实装 dispatch）
        // 仅在 maxTicks 到达时终止，否则继续 running
        if (thread.maxTicks > 0 && thread.ticks >= thread.maxTicks) {
            thread.status = "done";
        }
    } catch (error) {
        thread.status = "failed";
        thread.lastError = (error as Error).message;
    }
}
