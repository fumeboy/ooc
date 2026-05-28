/**
 * HTTP 控制面单元测试（无真实 LLM，无文件系统 IO）。
 *
 * 通过 Elysia app.handle() 测试 HTTP 路由，验证：
 * - GET /api/health
 * - POST /api/sessions → session + thread 创建
 * - GET /api/sessions/:sessionId → thread 快照
 * - GET /api/threads/:threadId → 单个 thread
 * - POST /api/sessions/:sessionId/invoke → 无 Object 时返回错误（world 空）
 */

import { describe, expect, test } from "bun:test";
import { buildApp } from "../http";
import { Worker } from "@src/thinkable/worker";
import { ObjectRegistry } from "@src/executable/registry";
import type { LlmClient, LlmGenerateResult } from "@src/thinkable/llm/types";

const mockLlm: LlmClient = {
    async generate(): Promise<LlmGenerateResult> {
        return {
            provider: "claude",
            model: "test",
            outputItems: [],
            text: "OK",
            toolCalls: [],
        };
    },
    stream: async function* () {},
};

function makeTestWorker(worldRoot = "/tmp/ooc-test-http-world"): Worker {
    return new Worker({ worldRoot, pollMs: 100 }, mockLlm, new ObjectRegistry());
}

async function json(response: Response): Promise<unknown> {
    return response.json();
}

describe("GET /api/health", () => {
    test("返回 ok + worldRoot", async () => {
        const worker = makeTestWorker("/tmp/ooc-test");
        const app = buildApp({ worker });
        const res = await app.handle(new Request("http://localhost/api/health"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; worldRoot: string };
        expect(body.ok).toBe(true);
        expect(body.worldRoot).toBe("/tmp/ooc-test");
    });
});

describe("POST /api/sessions", () => {
    test("缺 objectUri → 400", async () => {
        const app = buildApp({ worker: makeTestWorker() });
        const res = await app.handle(
            new Request("http://localhost/api/sessions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            }),
        );
        expect(res.status).toBe(400);
    });

    test("创建 session → 返回 sessionId + threadId", async () => {
        const worker = makeTestWorker();
        const app = buildApp({ worker });
        const res = await app.handle(
            new Request("http://localhost/api/sessions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    objectUri: "ooc://stones/main/objects/agent_a",
                    maxTicks: 2,
                }),
            }),
        );
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; sessionId: string; threadId: string };
        expect(body.ok).toBe(true);
        expect(typeof body.sessionId).toBe("string");
        expect(typeof body.threadId).toBe("string");
        // thread 已加入 worker queue
        expect(worker.get(body.threadId)).toBeDefined();
    });

    test("提交的 thread status=running", async () => {
        const worker = makeTestWorker();
        const app = buildApp({ worker });
        const res = await app.handle(
            new Request("http://localhost/api/sessions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ objectUri: "ooc://stones/main/objects/root" }),
            }),
        );
        const body = (await json(res)) as { threadId: string };
        const thread = worker.get(body.threadId)!;
        expect(thread.status).toBe("running");
    });
});

describe("GET /api/sessions/:sessionId", () => {
    test("未知 sessionId → 空 threads 数组", async () => {
        const app = buildApp({ worker: makeTestWorker() });
        const res = await app.handle(
            new Request("http://localhost/api/sessions/unknown_session"),
        );
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; threads: unknown[] };
        expect(body.ok).toBe(true);
        expect(body.threads).toEqual([]);
    });

    test("已创建 session → threads 包含正确 thread", async () => {
        const worker = makeTestWorker();
        const app = buildApp({ worker });

        // 先创建 session
        const createRes = await app.handle(
            new Request("http://localhost/api/sessions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ objectUri: "ooc://stones/main/objects/agent_a" }),
            }),
        );
        const created = (await json(createRes)) as { sessionId: string; threadId: string };

        // 再查询
        const getRes = await app.handle(
            new Request(`http://localhost/api/sessions/${created.sessionId}`),
        );
        const body = (await json(getRes)) as { threads: Array<{ id: string; objectUri: string }> };
        expect(body.threads.length).toBe(1);
        expect(body.threads[0]!.id).toBe(created.threadId);
        expect(body.threads[0]!.objectUri).toBe("ooc://stones/main/objects/agent_a");
    });
});

describe("GET /api/threads/:threadId", () => {
    test("不存在的 threadId → 404", async () => {
        const app = buildApp({ worker: makeTestWorker() });
        const res = await app.handle(
            new Request("http://localhost/api/threads/t_missing"),
        );
        expect(res.status).toBe(404);
    });

    test("存在的 threadId → 返回完整 thread", async () => {
        const worker = makeTestWorker();
        const app = buildApp({ worker });

        const createRes = await app.handle(
            new Request("http://localhost/api/sessions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ objectUri: "ooc://stones/main/objects/root" }),
            }),
        );
        const created = (await json(createRes)) as { threadId: string };

        const res = await app.handle(
            new Request(`http://localhost/api/threads/${created.threadId}`),
        );
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; thread: { id: string } };
        expect(body.ok).toBe(true);
        expect(body.thread.id).toBe(created.threadId);
    });
});

describe("POST /api/sessions/:sessionId/invoke", () => {
    test("缺 method → 400", async () => {
        const app = buildApp({ worker: makeTestWorker() });
        const res = await app.handle(
            new Request("http://localhost/api/sessions/s_test/invoke", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ objectUri: "ooc://stones/main/objects/root" }),
            }),
        );
        expect(res.status).toBe(400);
    });

    test("Object 不存在（空 world）→ 400 with error message", async () => {
        const app = buildApp({ worker: makeTestWorker("/tmp/nonexistent-world-xyz") });
        const res = await app.handle(
            new Request("http://localhost/api/sessions/s_test/invoke", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    objectUri: "ooc://stones/main/objects/missing",
                    method: "talk",
                    args: {},
                }),
            }),
        );
        expect(res.status).toBe(400);
        const body = (await json(res)) as { ok: boolean; error: string };
        expect(body.ok).toBe(false);
        expect(typeof body.error).toBe("string");
    });
});
