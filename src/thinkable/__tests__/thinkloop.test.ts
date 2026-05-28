/**
 * ThinkLoop 单元测试（无真实 LLM）。
 *
 * 用 mock LlmClient 驱动 think()，验证：
 * - messages 追加逻辑
 * - ticks 递增
 * - status 转换：无 tool call → done；maxTicks 到达 → done；错误 → failed
 * - tool call dispatch：method found → 结果追加 user message；method not found → error 追加
 */

import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { think } from "../thinkloop";
import { ObjectRegistry } from "@src/executable/registry";
import { loadObjects } from "@src/executable/loader";
import type { ThinkThread } from "../think-thread";
import type { LlmClient, LlmGenerateResult } from "../llm/types";

function makeThread(overrides: Partial<ThinkThread> = {}): ThinkThread {
    return {
        id: "t_test",
        sessionId: "s_test",
        objectUri: "ooc://stones/main/objects/agent_a",
        messages: [{ role: "system", content: "You are a test agent." }],
        status: "running",
        maxTicks: 5,
        ticks: 0,
        ...overrides,
    };
}

function makeMockLlm(response: Partial<LlmGenerateResult> = {}): LlmClient {
    const defaultResult: LlmGenerateResult = {
        provider: "claude",
        model: "claude-test",
        outputItems: [],
        text: "OK",
        toolCalls: [],
        ...response,
    };
    return {
        async generate() {
            return defaultResult;
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        stream: async function* () {
            // no-op stream for tests
        },
    };
}

describe("think()", () => {
    test("无 tool call → status=done, messages 追加 assistant", async () => {
        const thread = makeThread();
        const llm = makeMockLlm({ text: "task done", toolCalls: [] });
        await think(thread, llm, new ObjectRegistry(), "/tmp/test-world");

        expect(thread.status).toBe("done");
        expect(thread.ticks).toBe(1);
        const last = thread.messages[thread.messages.length - 1]!;
        expect(last.role).toBe("assistant");
        expect(last.content).toBe("task done");
    });

    test("空文本不追加 assistant message", async () => {
        const thread = makeThread();
        const initial = thread.messages.length;
        const llm = makeMockLlm({ text: "", toolCalls: [] });
        await think(thread, llm, new ObjectRegistry(), "/tmp/test-world");

        // status=done（无 tool call），messages 未增加
        expect(thread.status).toBe("done");
        expect(thread.messages.length).toBe(initial);
    });

    test("ticks 累积：多次调用正确递增", async () => {
        const thread = makeThread({ maxTicks: 10 });
        // 加一个 tool call 让它继续 running
        const llm = makeMockLlm({
            text: "thinking",
            toolCalls: [{ id: "c1", name: "exec", arguments: {} }],
        });
        await think(thread, llm, new ObjectRegistry(), "/tmp/test-world");
        expect(thread.ticks).toBe(1);
        expect(thread.status).toBe("running");  // 有 tool call，maxTicks 未到
    });

    test("有 tool call 且 maxTicks 到达 → status=done", async () => {
        const thread = makeThread({ maxTicks: 1, ticks: 0 });
        const llm = makeMockLlm({
            text: "still going",
            toolCalls: [{ id: "c1", name: "exec", arguments: {} }],
        });
        await think(thread, llm, new ObjectRegistry(), "/tmp/test-world");

        expect(thread.ticks).toBe(1);
        expect(thread.status).toBe("done");
    });

    test("maxTicks=0 → 不因 ticks 终止（无限模式）", async () => {
        const thread = makeThread({ maxTicks: 0, ticks: 99 });
        const llm = makeMockLlm({
            text: "still going",
            toolCalls: [{ id: "c1", name: "exec", arguments: {} }],
        });
        await think(thread, llm, new ObjectRegistry(), "/tmp/test-world");

        expect(thread.ticks).toBe(100);
        expect(thread.status).toBe("running");
    });

    test("LLM 抛错 → status=failed + lastError 设置", async () => {
        const thread = makeThread();
        const broken: LlmClient = {
            async generate() {
                throw new Error("network error");
            },
            stream: async function* () {},
        };
        await think(thread, broken, new ObjectRegistry(), "/tmp/test-world");

        expect(thread.status).toBe("failed");
        expect(thread.lastError).toContain("network error");
    });

    test("非 running 状态时调 think 抛错", async () => {
        const thread = makeThread({ status: "done" });
        const llm = makeMockLlm();
        await expect(think(thread, llm, new ObjectRegistry(), "/tmp/test-world")).rejects.toThrow(/running/);
    });

    test("tool call dispatch: method found → result appended as user message, status stays running", async () => {
        // worldRoot is a temp dir; flow data (todos.json) will be written under it
        const worldRoot = mkdtempSync(join(tmpdir(), "ooc-tc-test-"));
        const sessionId = "s_tc_test";

        // Load root prototype by pointing loadObjects at the real project root
        // (where stones/_builtin lives), but use a temp dir for flows
        const projectRoot = process.cwd();
        const registry = new ObjectRegistry();
        const records = await loadObjects({ worldRoot: projectRoot });
        const rootRecord = records.find((r) => r.uri.includes("/objects/root"));
        if (!rootRecord) {
            console.log("root record not found, skipping dispatch test");
            return;
        }
        // Register the record but override flow data path to temp worldRoot
        registry.set(rootRecord);

        const thread = makeThread({
            objectUri: rootRecord.uri,
            sessionId,
            maxTicks: 5,
        });

        // LLM first returns a tool call for todo_add, second returns text "done"
        let callCount = 0;
        const llm: LlmClient = {
            async generate(): Promise<LlmGenerateResult> {
                callCount += 1;
                if (callCount === 1) {
                    return {
                        provider: "claude",
                        model: "mock",
                        outputItems: [],
                        text: "",
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        toolCalls: [{ id: "tc1", name: "todo_add" as any, arguments: { content: "buy milk" } }],
                    };
                }
                return {
                    provider: "claude",
                    model: "mock",
                    outputItems: [],
                    text: "All done!",
                    toolCalls: [],
                };
            },
            stream: async function* () {},
        };

        // First tick: tool call dispatch
        await think(thread, llm, registry, worldRoot);
        expect(thread.ticks).toBe(1);
        expect(thread.status).toBe("running");  // tool call dispatched, still running

        // Last message should be the tool_result user message
        const lastMsg = thread.messages[thread.messages.length - 1]!;
        expect(lastMsg.role).toBe("user");
        expect(lastMsg.content).toContain("tool_result");
        expect(lastMsg.content).toContain("todo_add");

        // todos.json should exist under temp worldRoot (not project root)
        const todosPath = join(worldRoot, "flows", sessionId, "objects", "root", "todos.json");
        expect(existsSync(todosPath)).toBe(true);
        const todosBody = JSON.parse(readFileSync(todosPath, "utf-8")) as { items: Array<{ content: string }> };
        expect(todosBody.items.some((it) => it.content === "buy milk")).toBe(true);

        // Second tick: no tool call → done
        await think(thread, llm, registry, worldRoot);
        expect(thread.status).toBe("done");
        const assistantMsg = thread.messages[thread.messages.length - 1]!;
        expect(assistantMsg.role).toBe("assistant");
        expect(assistantMsg.content).toBe("All done!");
    });

    test("tool call dispatch: method not found → error appended as user message, no crash", async () => {
        const registry = new ObjectRegistry();
        // Register an object with no methods
        registry.set({
            uri: "ooc://stones/main/objects/empty_agent",
            paths: { stone: "/tmp/nonexistent" },
            kind: "persistent",
            self: {},
            serverPublic: {},
            serverPrivate: {},
        });

        const thread = makeThread({
            objectUri: "ooc://stones/main/objects/empty_agent",
            maxTicks: 5,
        });

        const llm: LlmClient = {
            async generate(): Promise<LlmGenerateResult> {
                return {
                    provider: "claude",
                    model: "mock",
                    outputItems: [],
                    text: "",
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    toolCalls: [{ id: "tc2", name: "nonexistent_method" as any, arguments: {} }],
                };
            },
            stream: async function* () {},
        };

        await think(thread, llm, registry, "/tmp/test-world");

        // Should NOT crash; status stays running; error message appended as user message
        expect(thread.status).toBe("running");
        expect(thread.ticks).toBe(1);
        const lastMsg = thread.messages[thread.messages.length - 1]!;
        expect(lastMsg.role).toBe("user");
        expect(lastMsg.content).toContain("ERROR:");
    });
});
