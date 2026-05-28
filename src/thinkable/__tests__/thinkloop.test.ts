/**
 * ThinkLoop 单元测试（无真实 LLM）。
 *
 * 用 mock LlmClient 驱动 think()，验证：
 * - messages 追加逻辑
 * - ticks 递增
 * - status 转换：无 tool call → done；maxTicks 到达 → done；错误 → failed
 */

import { describe, expect, test } from "bun:test";
import { think } from "../thinkloop";
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
        await think(thread, llm);

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
        await think(thread, llm);

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
        await think(thread, llm);
        expect(thread.ticks).toBe(1);
        expect(thread.status).toBe("running");  // 有 tool call，maxTicks 未到
    });

    test("有 tool call 且 maxTicks 到达 → status=done", async () => {
        const thread = makeThread({ maxTicks: 1, ticks: 0 });
        const llm = makeMockLlm({
            text: "still going",
            toolCalls: [{ id: "c1", name: "exec", arguments: {} }],
        });
        await think(thread, llm);

        expect(thread.ticks).toBe(1);
        expect(thread.status).toBe("done");
    });

    test("maxTicks=0 → 不因 ticks 终止（无限模式）", async () => {
        const thread = makeThread({ maxTicks: 0, ticks: 99 });
        const llm = makeMockLlm({
            text: "still going",
            toolCalls: [{ id: "c1", name: "exec", arguments: {} }],
        });
        await think(thread, llm);

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
        await think(thread, broken);

        expect(thread.status).toBe("failed");
        expect(thread.lastError).toContain("network error");
    });

    test("非 running 状态时调 think 抛错", async () => {
        const thread = makeThread({ status: "done" });
        const llm = makeMockLlm();
        await expect(think(thread, llm)).rejects.toThrow(/running/);
    });
});
