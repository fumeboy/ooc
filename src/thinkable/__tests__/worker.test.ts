/**
 * Worker 单元测试（无真实 LLM）。
 *
 * 验证：
 * - submit / get / list
 * - tick 调度 running thread
 * - runUntilDone 等待所有 thread 终止
 * - 多 thread 按 running 状态轮询
 */

import { describe, expect, test } from "bun:test";
import { Worker } from "../worker";
import type { ThinkThread } from "../think-thread";
import type { LlmClient, LlmGenerateResult } from "../llm/types";

const defaultResult: LlmGenerateResult = {
    provider: "claude",
    model: "claude-test",
    outputItems: [],
    text: "OK",
    toolCalls: [],
};

function makeMockLlm(response: Partial<LlmGenerateResult> = {}): LlmClient {
    return {
        async generate() {
            return { ...defaultResult, ...response };
        },
        stream: async function* () {},
    };
}

function makeWorker(pollMs = 10): { worker: Worker; llm: LlmClient } {
    const llm = makeMockLlm();
    const worker = new Worker({ worldRoot: "/tmp/test-world", pollMs }, llm);
    return { worker, llm };
}

function makeThread(id: string, overrides: Partial<ThinkThread> = {}): ThinkThread {
    return {
        id,
        sessionId: "s_test",
        objectUri: "ooc://stones/main/objects/agent_a",
        messages: [{ role: "system", content: "Be helpful." }],
        status: "running",
        maxTicks: 3,
        ticks: 0,
        ...overrides,
    };
}

describe("Worker: submit / get / list", () => {
    test("submit + get", () => {
        const { worker } = makeWorker();
        const thread = makeThread("t_1");
        worker.submit(thread);
        expect(worker.get("t_1")).toBe(thread);
    });

    test("list 返回所有 thread", () => {
        const { worker } = makeWorker();
        worker.submit(makeThread("t_a"));
        worker.submit(makeThread("t_b"));
        expect(worker.list().length).toBe(2);
    });

    test("submit 同 id 覆盖", () => {
        const { worker } = makeWorker();
        const t1 = makeThread("t_x");
        const t2 = { ...makeThread("t_x"), maxTicks: 99 };
        worker.submit(t1);
        worker.submit(t2);
        expect(worker.get("t_x")?.maxTicks).toBe(99);
    });

    test("worldRoot getter 暴露正确值", () => {
        const { worker } = makeWorker();
        expect(worker.worldRoot).toBe("/tmp/test-world");
    });
});

describe("Worker: tick", () => {
    test("tick 推进 running thread 状态", async () => {
        const { worker } = makeWorker();
        const thread = makeThread("t_tick", { maxTicks: 1 });
        worker.submit(thread);
        await worker.tick();
        // maxTicks=1, 无 tool call → done after 1 tick
        expect(thread.status).toBe("done");
    });

    test("tick 对非 running thread 无操作", async () => {
        const { worker } = makeWorker();
        const thread = makeThread("t_skip", { status: "done", ticks: 5 });
        worker.submit(thread);
        await worker.tick();
        expect(thread.ticks).toBe(5);  // 未改变
    });

    test("tick 不重入（activeTick guard）", async () => {
        const { worker } = makeWorker(0);
        const thread = makeThread("t_reenter", { maxTicks: 10 });
        worker.submit(thread);

        // 同时触发两次 tick
        const p1 = worker.tick();
        const p2 = worker.tick();
        await Promise.all([p1, p2]);

        // 只有一个 tick 真正执行：ticks <= 1
        expect(thread.ticks).toBeLessThanOrEqual(1);
    });
});

describe("Worker: runUntilDone", () => {
    test("runUntilDone 等待单个 thread 完成", async () => {
        const { worker } = makeWorker();
        const thread = makeThread("t_run", { maxTicks: 3 });
        worker.submit(thread);
        await worker.runUntilDone(5000);
        expect(thread.status).toBe("done");
    });

    test("runUntilDone 多 thread 全部完成", async () => {
        const { worker } = makeWorker();
        for (let i = 0; i < 3; i++) {
            worker.submit(makeThread(`t_multi_${i}`, { maxTicks: 2 }));
        }
        await worker.runUntilDone(10000);
        for (const t of worker.list()) {
            expect(t.status).toBe("done");
        }
    });

    test("runUntilDone: queue 为空直接返回", async () => {
        const { worker } = makeWorker();
        await expect(worker.runUntilDone(1000)).resolves.toBeUndefined();
    });

    test("runUntilDone: LLM 持续失败 → thread failed → 可退出", async () => {
        const brokenLlm: LlmClient = {
            async generate() { throw new Error("always fails"); },
            stream: async function* () {},
        };
        const worker = new Worker({ worldRoot: "/tmp/world", pollMs: 1 }, brokenLlm);
        const thread = makeThread("t_fail", { maxTicks: 3 });
        worker.submit(thread);
        await worker.runUntilDone(5000);
        // LLM 抛错 → thread.status=failed → not running → runUntilDone 退出
        expect(thread.status).toBe("failed");
    });
});

describe("Worker: start / stop", () => {
    test("start + stop 不抛错", async () => {
        const { worker } = makeWorker(100);
        worker.start();
        worker.stop();
        // no errors thrown
    });

    test("重复 start 是 no-op", () => {
        const { worker } = makeWorker(100);
        worker.start();
        worker.start();  // second call is no-op
        worker.stop();
    });
});
