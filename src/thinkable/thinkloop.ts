/**
 * ThinkLoop: 单轮 LLM 执行器。
 *
 * 负责编排一轮 LLM 调用：
 * 1. 检查 thread 状态（只处理 running）
 * 2. 调用 LlmClient.generate（使用 thread.messages 作为 input）
 * 3. 若 LLM 返回 tool calls → 逐个 dispatch，把结果追加为 user message（tool_result）
 * 4. 若 LLM 返回 text 且没有 tool call → 追加 assistant 消息并视为 done
 * 5. ticks++ 到达 maxTicks → status=done
 * 6. 错误 → status=failed + lastError
 */

import type { LlmClient } from "./llm/types";
import type { ThinkThread } from "./think-thread";
import type { ObjectRegistry } from "@src/executable/registry";
import { invokeMethod } from "@src/executable/dispatcher";

/**
 * 执行 thread 的一轮 think。
 *
 * 副作用：修改 thread.messages / thread.status / thread.ticks / thread.lastError。
 * 调用方负责持久化（如有需要）。
 *
 * @param thread     当前执行的 ThinkThread
 * @param llmClient  LLM 客户端
 * @param registry   Object 注册表，用于 tool call dispatch
 * @param worldRoot  world 根目录，透传给 ObjectContext
 */
export async function think(
    thread: ThinkThread,
    llmClient: LlmClient,
    registry: ObjectRegistry,
    worldRoot: string,
): Promise<void> {
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

        // 无 tool call → 视为对话结束
        if (result.toolCalls.length === 0) {
            thread.status = "done";
            return;
        }

        // 有 tool call → dispatch 每一个，把结果追加为 user message
        for (const toolCall of result.toolCalls) {
            let output: string;
            try {
                const args =
                    typeof toolCall.arguments === "string"
                        ? (JSON.parse(toolCall.arguments) as Record<string, unknown>)
                        : toolCall.arguments;

                const dispatchResult = await invokeMethod(
                    registry,
                    thread.objectUri,
                    toolCall.name,
                    args,
                    {
                        worldRoot,
                        sessionId: thread.sessionId,
                        registry,
                    },
                );
                output = typeof dispatchResult === "string"
                    ? dispatchResult
                    : JSON.stringify(dispatchResult);
            } catch (err) {
                // dispatch 失败不崩溃 thinkloop，把错误作为 tool result 反馈给 LLM
                output = `ERROR: ${(err as Error).message}`;
            }

            // 把 tool result 追加为 user message，供下一轮 LLM 消费
            thread.messages = [
                ...thread.messages,
                {
                    role: "user",
                    content: `[tool_result tool_call_id="${toolCall.id}" name="${toolCall.name}"]\n${output}\n[/tool_result]`,
                },
            ];
        }

        // maxTicks 检查（dispatch 后）
        if (thread.maxTicks > 0 && thread.ticks >= thread.maxTicks) {
            thread.status = "done";
        }
        // 否则 status 保持 "running"，继续下一轮
    } catch (error) {
        thread.status = "failed";
        thread.lastError = (error as Error).message;
    }
}
