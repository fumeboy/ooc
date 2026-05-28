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

import type { LlmClient, LlmTool } from "./llm/types";
import type { ThinkThread } from "./think-thread";
import type { ObjectRegistry } from "@src/executable/registry";
import { invokeMethod, listPublicMethods } from "@src/executable/dispatcher";

/**
 * Known method schemas: provide typed descriptions + parameter schemas so the LLM doesn't waste
 * ticks on trial-and-error. Falls back to permissive schema for unknown methods.
 */
const METHOD_SCHEMAS: Record<string, { description: string; properties?: Record<string, unknown>; required?: string[] }> = {
    talk: {
        description: "Send a message to another Object (talk to a peer).",
        properties: {
            target: { type: "string", description: "Target Object URI (e.g., ooc://stones/main/objects/user)" },
            content: { type: "string" },
        },
        required: ["target", "content"],
    },
    todo_add: { description: "Add a todo item to your task list.", properties: { content: { type: "string" } }, required: ["content"] },
    todo_check: { description: "Mark a todo item as done.", properties: { id: { type: "string" } }, required: ["id"] },
    todo_uncheck: { description: "Mark a todo item as not done.", properties: { id: { type: "string" } }, required: ["id"] },
    todo_remove: { description: "Remove a todo item.", properties: { id: { type: "string" } }, required: ["id"] },
    todo_list: { description: "List all todo items.", properties: {} },
    plan_set: { description: "Set the current plan text (guides your thinking).", properties: { text: { type: "string" } }, required: ["text"] },
    plan_clear: { description: "Clear the current plan.", properties: {} },
    grep: {
        description: "Search for a regex pattern in files (relative to your world root). Returns matches.",
        properties: {
            pattern: { type: "string" },
            path: { type: "string", description: "Optional sub-path relative to world root" },
        },
        required: ["pattern"],
    },
    glob: {
        description: "Find files matching a name pattern (e.g., '*.ts'). Returns file paths.",
        properties: {
            pattern: { type: "string" },
            path: { type: "string", description: "Optional sub-path relative to world root" },
        },
        required: ["pattern"],
    },
    open_file: {
        description: "Read the contents of a file (relative to your world root). Returns file content.",
        properties: { path: { type: "string" } },
        required: ["path"],
    },
    write_file: {
        description: "Write content to a file (relative to your world root). Creates or overwrites.",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
    },
    exec_command: {
        description: "Execute a shell command and capture stdout/stderr.",
        properties: {
            command: { type: "array", items: { type: "string" }, description: "Command as array, e.g., ['ls', '-la']" },
            cwd: { type: "string", description: "Optional cwd relative to world root" },
            timeout_ms: { type: "number" },
        },
        required: ["command"],
    },
    do: {
        description: "Spawn a sub-thread to work on a sub-task. Note: creates thread record only; actual execution requires P6+ infrastructure.",
        properties: {
            intent: { type: "string" },
            parent_thread_id: { type: "string" },
        },
        required: ["intent"],
    },
    do_close: { description: "Close an active sub-thread.", properties: { thread_id: { type: "string" } }, required: ["thread_id"] },
    metaprog: { description: "(Skeleton, P8+) Modify your own stone source.", properties: { intent: { type: "string" } }, required: ["intent"] },
    open_knowledge: { description: "(Skeleton, P6+) Open a knowledge slug.", properties: { slug: { type: "string" } }, required: ["slug"] },
    end: { description: "End the conversation.", properties: {} },
};

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
        // Inject defaultContext slices as a context block before the first LLM call in this tick.
        // Only inject on tick 0 to avoid re-injecting on every tick.
        let messagesWithContext = thread.messages;
        if (thread.ticks === 0) {
            try {
                const record = registry.get(thread.objectUri);
                if (record) {
                    const ctx = { record, worldRoot, sessionId: thread.sessionId, registry };
                    // Dynamically import defaultContext to avoid hard coupling
                    const rootModule = await import("stones/_builtin/objects/root/server/index.ts");
                    if (typeof rootModule.defaultContext === "function") {
                        const slices = await rootModule.defaultContext(ctx);
                        if (slices.length > 0) {
                            const contextText = slices.map((s: { kind: string; payload: unknown }) => {
                                const payload = typeof s.payload === "string"
                                    ? s.payload
                                    : JSON.stringify(s.payload, null, 2);
                                return `[context:${s.kind}]\n${payload}\n[/context:${s.kind}]`;
                            }).join("\n\n");
                            const contextMessage = {
                                role: "user" as const,
                                content: `[OOC context snapshot for this tick]\n${contextText}\n[/OOC context snapshot]`,
                            };
                            // Insert context message right before the last user message
                            const lastUserIdx = [...messagesWithContext].reduce(
                                (acc, m, i) => (m.role === "user" ? i : acc),
                                -1,
                            );
                            if (lastUserIdx >= 0) {
                                messagesWithContext = [
                                    ...messagesWithContext.slice(0, lastUserIdx),
                                    contextMessage,
                                    ...messagesWithContext.slice(lastUserIdx),
                                ];
                            } else {
                                messagesWithContext = [...messagesWithContext, contextMessage];
                            }
                        }
                    }
                }
            } catch {
                // defaultContext injection is best-effort; don't block execution on failure
            }
        }

        // 动态从 Object prototype 链收集 public methods，构建 LlmTool 定义传给 LLM。
        // 若 objectUri 不在 registry（如测试中使用空 registry），安全降级为无工具。
        let tools: LlmTool[] = [];
        try {
            const methodNames = listPublicMethods(registry, thread.objectUri);
            tools = methodNames.map((name) => {
                const schema = METHOD_SCHEMAS[name];
                if (schema) {
                    return {
                        name,
                        description: schema.description,
                        inputSchema: {
                            type: "object" as const,
                            properties: schema.properties ?? {},
                            ...(schema.required ? { required: schema.required } : {}),
                            additionalProperties: false,
                        },
                    };
                }
                // Permissive fallback for unknown methods
                return {
                    name,
                    description: `Call the ${name} method on this object.`,
                    inputSchema: { type: "object" as const, additionalProperties: true },
                };
            });
        } catch {
            // registry 中不存在该 objectUri 时，不暴露 tool list 给 LLM
        }

        const result = await llmClient.generate({
            input: messagesWithContext.map((m) => ({
                type: "message" as const,
                role: m.role,
                content: m.content,
            })),
            tools: tools.length > 0 ? tools : undefined,
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
