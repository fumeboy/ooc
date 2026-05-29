/**
 * ThinkLoop: 单轮 LLM 执行器。
 *
 * 负责编排一轮 LLM 调用：
 * 1. 检查 thread 状态（只处理 running）
 * 2. 注入 defaultContext 快照（每 tick 刷新，确保状态变化可见）
 * 3. 调用 LlmClient.generate（使用 thread.messages 作为 input）
 * 4. 将 LLM 输出 function_call items 存入 thread.messages（原生类型，非 plain text 包裹）
 * 5. dispatch 每个 tool call，结果存为 function_call_output item
 * 6. 若 tool result 携带 __ooc_thread_action:"end" → status=done，终止 loop
 * 7. 若 LLM 返回 text 且没有 tool call → 追加 assistant message，status=done
 * 8. ticks++ 到达 maxTicks → status=done
 * 9. 错误 → status=failed + lastError
 */

import * as path from "node:path";
import type { LlmClient, LlmInputItem, LlmTool } from "./llm/types";
import type { ThinkThread } from "./think-thread";
import type { ObjectRegistry } from "@src/executable/registry";
import { invokeMethod, listPublicMethods } from "@src/executable/dispatcher";
import { nameFromUri } from "@src/persistable/flow-paths";

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
        description: "Execute a shell command and capture stdout/stderr. Optionally pass stdin text.",
        properties: {
            command: { type: "array", items: { type: "string" }, description: "Command as array, e.g., ['ls', '-la']" },
            cwd: { type: "string", description: "Optional cwd relative to world root" },
            timeout_ms: { type: "number" },
            stdin: { type: "string", description: "Optional text to pass as stdin to the process" },
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
    memory_record: {
        description: "Save a piece of long-term memory that persists across all sessions. Use this when you learn something important that should be remembered next time.",
        properties: {
            slug: { type: "string", description: "Short kebab-case identifier, e.g. 'user-favorite-color'" },
            content: { type: "string" },
        },
        required: ["slug", "content"],
    },
    metaprog: {
        description: "Read your own stone source file and get instructions to update it. Provide target_file relative to your stone dir (e.g., 'readme.md', 'server/index.ts'). Returns current content + path for write_file.",
        properties: {
            intent: { type: "string", description: "What you want to change/view" },
            target_file: { type: "string", description: "File path relative to object stone dir" },
        },
        required: ["intent", "target_file"],
    },
    open_knowledge: { description: "(Skeleton, P6+) Open a knowledge slug.", properties: { slug: { type: "string" } }, required: ["slug"] },
    end: { description: "End the conversation. Call this after you've sent your final reply via talk().", properties: {} },
    repo_read: {
        description: "Read any file in the OOC-3 source tree (relative to repo root). IMPORTANT: by default, files longer than 200 lines are auto-truncated to the first 200 lines (response includes truncated:true, lines_total). Use lines:[start,end] to read a specific range (max 500 lines per read). Prefer narrow reads once you know the target line from repo_search.",
        properties: {
            path: { type: "string", description: "File path relative to repo root" },
            lines: {
                type: "array",
                items: { type: "number" },
                description: "Optional [start, end] (1-indexed, inclusive) to read only a line range. Max 500 lines per read. Out-of-range values are clamped silently. Response always includes lines_total.",
            },
        },
        required: ["path"],
    },
    repo_search: {
        description: "Recursively search the repo for a regex pattern. Walks REPO_ROOT, skipping node_modules/.git/dist/.ooc-world, and returns line-level matches. Use this to locate code without reading entire files.",
        properties: {
            pattern: { type: "string", description: "Regex pattern (JS RegExp syntax) to search for." },
            path: { type: "string", description: "Optional sub-path under repo root to limit the search (file or directory)." },
            max_results: { type: "number", description: "Max matches returned (default 100)." },
        },
        required: ["pattern"],
    },
    repo_write: {
        description: "Write to any file in the OOC-3 source tree (relative to repo root). Use this to modify the system's source code, frontend, configs, stones, or docs. WARNING: changes affect the live system. Always run repo_run_tsc after code changes and repo_run_tests after structural changes.",
        properties: {
            path: { type: "string", description: "File path relative to repo root" },
            content: { type: "string", description: "Full file content to write" },
        },
        required: ["path", "content"],
    },
    repo_run_tests: {
        description: "Run bun test [pattern] from repo root to verify changes. Returns stdout/stderr and exit code. Use after modifying source code to confirm nothing is broken. Skip in fast iterations; run before committing.",
        properties: {
            pattern: { type: "string", description: "Optional test file pattern or path to run specific tests" },
        },
    },
    repo_run_tsc: {
        description: "Run bunx tsc --noEmit from repo root to type-check the codebase. Returns error count and output. Run after any TypeScript source changes to catch type errors before testing.",
        properties: {},
    },
    repo_git_diff: {
        description: "Show git diff for the repo (or a specific path). Use to inspect what changed before committing.",
        properties: {
            path: { type: "string", description: "Optional file/dir path relative to repo root to diff" },
        },
    },
    repo_git_status: {
        description: "Show git status --short for the repo. Use to see which files were modified before committing.",
        properties: {},
    },
    repo_git_commit: {
        description: "Commit staged/changed files with a [ooc-iteration] prefix for traceability. Does NOT push (human will review). Appends Iterated-By footer automatically. Use only after verifying tsc + tests are green.",
        properties: {
            message: { type: "string", description: "Commit message. Will be prefixed with [ooc-iteration] if not already." },
            files: { type: "array", items: { type: "string" }, description: "Optional list of files to stage. Omit to stage all changes." },
        },
        required: ["message"],
    },
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
        // Inject defaultContext snapshot as a system message before the LLM call.
        // Done every tick so state changes (new todos, plan updates) are visible.
        // The context message is injected into the call input but NOT stored in thread.messages
        // (avoids ever-growing message history; treat it as ephemeral prompt injection).

        // Sliding window truncation: keep first 3 + last 30, drop middle if > 50 messages.
        // Only applied to the LLM call input, NOT mutated into thread.messages (persisted state).
        let inputItems: LlmInputItem[] = (() => {
            const msgs = thread.messages;
            const WINDOW_THRESHOLD = 50;
            const KEEP_HEAD = 3;
            const KEEP_TAIL = 30;
            if (msgs.length <= WINDOW_THRESHOLD) return msgs;
            const head = msgs.slice(0, KEEP_HEAD);
            const tail = msgs.slice(msgs.length - KEEP_TAIL);
            const droppedCount = msgs.length - KEEP_HEAD - KEEP_TAIL;
            const truncationNotice: LlmInputItem = {
                type: "message",
                role: "system",
                content: `... [${droppedCount} earlier messages truncated for context] ...`,
            };
            return [...head, truncationNotice, ...tail];
        })();
        // Mid-task decisiveness nudge: when past the halfway point, remind the agent to act
        // if it already has enough information. Soft nudge only — does not force termination.
        if (thread.maxTicks > 0 && thread.ticks > thread.maxTicks / 2) {
            const nudge: LlmInputItem = {
                type: "message",
                role: "system",
                content: `[system] You have used ${thread.ticks} of ${thread.maxTicks} ticks. If you have enough information to complete the task, do so now without further exploration.`,
            };
            inputItems = [...inputItems, nudge];
        }

        try {
            const record = registry.get(thread.objectUri);
            if (record) {
                // Synthesize flow path for this session (registry record may not have it)
                const objectName = nameFromUri(thread.objectUri);
                const flowPath = path.join(worldRoot, "flows", thread.sessionId, "objects", objectName);
                const ctxRecord = { ...record, paths: { ...record.paths, flow: flowPath } };
                const rootModule = await import("stones/_builtin/objects/root/server/index.ts");
                if (typeof rootModule.defaultContext === "function") {
                    const ctx = { record: ctxRecord, worldRoot, sessionId: thread.sessionId, registry };
                    const slices = await rootModule.defaultContext(ctx);
                    if (slices.length > 0) {
                        // Sort so self_identity always appears first in context snapshot
                    const sortedSlices = [...slices].sort((a, b) => {
                        if (a.kind === "self_identity") return -1;
                        if (b.kind === "self_identity") return 1;
                        return 0;
                    });
                    const contextText = sortedSlices.map((s: { kind: string; payload: unknown }) => {
                            if (s.kind === "self_identity") {
                                const p = s.payload as { title?: string; description?: string; body?: string };
                                const parts: string[] = [];
                                if (p.title) parts.push(`# ${p.title}`);
                                if (p.description) parts.push(p.description);
                                if (p.body) parts.push(p.body);
                                return `[identity]\n${parts.join("\n\n")}\n[/identity]`;
                            }
                            const payload = typeof s.payload === "string"
                                ? s.payload
                                : JSON.stringify(s.payload, null, 2);
                            return `[context:${s.kind}]\n${payload}\n[/context:${s.kind}]`;
                        }).join("\n\n");
                        const contextItem: LlmInputItem = {
                            type: "message",
                            role: "system",
                            content: `[OOC context snapshot]\n${contextText}\n[/OOC context snapshot]`,
                        };
                        // Insert context item right before the last non-system message
                        const lastUserIdx = [...inputItems].reduce(
                            (acc, m, i) => (m.type === "message" && m.role === "user" ? i : acc),
                            -1,
                        );
                        if (lastUserIdx >= 0) {
                            inputItems = [
                                ...inputItems.slice(0, lastUserIdx),
                                contextItem,
                                ...inputItems.slice(lastUserIdx),
                            ];
                        } else {
                            inputItems = [...inputItems, contextItem];
                        }
                    }
                }
            }
        } catch {
            // defaultContext injection is best-effort; don't block execution on failure
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
            input: inputItems,
            tools: tools.length > 0 ? tools : undefined,
            timeoutMs: thread.llmTimeoutMs,
        });

        // 追加 LLM 文本回复到 messages（assistant message item）
        if (result.text) {
            thread.messages = [
                ...thread.messages,
                { type: "message", role: "assistant", content: result.text },
            ];
        }

        // Store function_call items from LLM output directly in thread.messages (native type).
        // This is critical for provider transports to generate proper tool_result blocks.
        for (const item of result.outputItems) {
            if (item.type === "function_call") {
                thread.messages = [...thread.messages, item];
            }
        }

        thread.ticks += 1;

        // 无 tool call → 视为对话结束
        if (result.toolCalls.length === 0) {
            thread.status = "done";
            return;
        }

        // 有 tool call → dispatch 每一个，把结果存为 function_call_output item（原生类型）
        for (const toolCall of result.toolCalls) {
            let output: string;
            let isEndAction = false;
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

                // Check for end() sentinel
                if (
                    dispatchResult !== null &&
                    typeof dispatchResult === "object" &&
                    (dispatchResult as Record<string, unknown>).__ooc_thread_action === "end"
                ) {
                    isEndAction = true;
                }

                output = typeof dispatchResult === "string"
                    ? dispatchResult
                    : JSON.stringify(dispatchResult);
            } catch (err) {
                // dispatch 失败不崩溃 thinkloop，把错误作为 tool result 反馈给 LLM
                output = `ERROR: ${(err as Error).message}`;
            }

            // Store as function_call_output item (native type, not plain text wrapper)
            thread.messages = [
                ...thread.messages,
                {
                    type: "function_call_output",
                    call_id: toolCall.id,
                    name: toolCall.name,
                    output,
                },
            ];

            // If end() sentinel received, terminate thread immediately
            if (isEndAction) {
                thread.status = "done";
                return;
            }
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
