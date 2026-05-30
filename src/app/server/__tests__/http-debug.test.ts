/**
 * HTTP debug + permission HITL endpoint tests.
 *
 * Covers:
 *   GET  /api/runtime/debug/status
 *   POST /api/runtime/debug/enable
 *   POST /api/runtime/debug/disable
 *   GET  /api/runtime/flows/:s/objects/:o/threads/:t/debug/loops
 *   GET  /api/runtime/flows/:s/objects/:o/threads/:t/debug/loops/:i
 *   POST /api/runtime/flows/:s/objects/:o/threads/:t/permission
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../http";
import { Worker } from "@src/thinkable/worker";
import { ObjectRegistry } from "@src/executable/registry";
import { createDebugStore } from "../runtime/debug-store";
import type { LlmClient, LlmGenerateResult } from "@src/thinkable/llm/types";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const mockLlm: LlmClient = {
    async generate(): Promise<LlmGenerateResult> {
        return { provider: "claude", model: "test", outputItems: [], text: "OK", toolCalls: [] };
    },
    stream: async function* () {},
};

async function makeTempWorld(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), "ooc-http-debug-test-"));
}

async function json(response: Response): Promise<unknown> {
    return response.json();
}

function makeWorker(worldRoot: string): Worker {
    return new Worker({ worldRoot, pollMs: 100 }, mockLlm, new ObjectRegistry());
}

/* ========================= debug toggle ========================= */

describe("GET /api/runtime/debug/status", () => {
    test("returns enabled=false by default (no env var)", async () => {
        const debugStore = createDebugStore();
        debugStore.disable(); // ensure off
        const app = buildApp({ worker: makeWorker("/tmp/ooc-debug-status"), debugStore });
        const res = await app.handle(new Request("http://localhost/api/runtime/debug/status"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; enabled: boolean };
        expect(body.ok).toBe(true);
        expect(typeof body.enabled).toBe("boolean");
    });

    test("returns enabled=true after enable", async () => {
        const debugStore = createDebugStore();
        debugStore.disable();
        const app = buildApp({ worker: makeWorker("/tmp/ooc-debug-status2"), debugStore });

        await app.handle(new Request("http://localhost/api/runtime/debug/enable", { method: "POST" }));
        const res = await app.handle(new Request("http://localhost/api/runtime/debug/status"));
        const body = (await json(res)) as { ok: boolean; enabled: boolean };
        expect(body.enabled).toBe(true);
    });
});

describe("POST /api/runtime/debug/enable + /disable", () => {
    test("enable → returns enabled=true", async () => {
        const debugStore = createDebugStore();
        debugStore.disable();
        const app = buildApp({ worker: makeWorker("/tmp/ooc-debug-toggle"), debugStore });

        const res = await app.handle(new Request("http://localhost/api/runtime/debug/enable", { method: "POST" }));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; enabled: boolean };
        expect(body.ok).toBe(true);
        expect(body.enabled).toBe(true);
    });

    test("disable → returns enabled=false", async () => {
        const debugStore = createDebugStore();
        debugStore.enable();
        const app = buildApp({ worker: makeWorker("/tmp/ooc-debug-toggle2"), debugStore });

        const res = await app.handle(new Request("http://localhost/api/runtime/debug/disable", { method: "POST" }));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; enabled: boolean };
        expect(body.ok).toBe(true);
        expect(body.enabled).toBe(false);
    });
});

/* ========================= loop debug list ========================= */

describe("GET /api/runtime/flows/:s/objects/:o/threads/:t/debug/loops", () => {
    let worldRoot: string;
    const sessionId = "ses_debug01";
    const objectName = "supervisor";
    const threadId = "t_debug01";

    beforeAll(async () => {
        worldRoot = await makeTempWorld();
        // Create debug files for loop 0 and loop 1
        const debugDir = path.join(
            worldRoot, "flows", sessionId, "objects", objectName,
            "threads", threadId, "debug",
        );
        await fs.mkdir(debugDir, { recursive: true });

        const meta0 = {
            threadId,
            loopIndex: 0,
            startedAt: 1000,
            finishedAt: 1500,
            latencyMs: 500,
            messageCount: 2,
            toolCount: 3,
            toolCallCount: 1,
            contextBytes: 200,
            resultTextBytes: 50,
            status: "ok",
        };
        await fs.writeFile(path.join(debugDir, "loop_0000.meta.json"), JSON.stringify(meta0));
        await fs.writeFile(path.join(debugDir, "loop_0000.input.json"), JSON.stringify({ threadId, inputItems: [] }));

        const meta1 = {
            threadId,
            loopIndex: 1,
            startedAt: 2000,
            finishedAt: 2800,
            latencyMs: 800,
            messageCount: 4,
            toolCount: 3,
            toolCallCount: 0,
            contextBytes: 400,
            resultTextBytes: 100,
            status: "ok",
        };
        await fs.writeFile(path.join(debugDir, "loop_0001.meta.json"), JSON.stringify(meta1));
        await fs.writeFile(path.join(debugDir, "loop_0001.input.json"), JSON.stringify({ threadId, inputItems: [] }));
        await fs.writeFile(path.join(debugDir, "loop_0001.output.json"), JSON.stringify({ threadId, outputItems: [] }));
    });

    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("lists loop indices with meta", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const url = `http://localhost/api/runtime/flows/${sessionId}/objects/${objectName}/threads/${threadId}/debug/loops`;
        const res = await app.handle(new Request(url));
        expect(res.status).toBe(200);
        const body = (await json(res)) as {
            ok: boolean;
            loops: Array<{ loopIndex: number; hasInput: boolean; hasOutput: boolean; hasMeta: boolean }>;
        };
        expect(body.ok).toBe(true);
        expect(body.loops).toHaveLength(2);
        expect(body.loops[0]!.loopIndex).toBe(0);
        expect(body.loops[0]!.hasInput).toBe(true);
        expect(body.loops[0]!.hasOutput).toBe(false);
        expect(body.loops[0]!.hasMeta).toBe(true);
        expect(body.loops[1]!.loopIndex).toBe(1);
        expect(body.loops[1]!.hasInput).toBe(true);
        expect(body.loops[1]!.hasOutput).toBe(true);
    });

    test("returns empty loops when debug dir doesn't exist", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const url = `http://localhost/api/runtime/flows/ses_nonexist/objects/obj/threads/t1/debug/loops`;
        const res = await app.handle(new Request(url));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; loops: unknown[] };
        expect(body.ok).toBe(true);
        expect(body.loops).toHaveLength(0);
    });

    test("invalid sessionId → 400", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        // Use a sessionId with invalid chars (spaces)
        const url = "http://localhost/api/runtime/flows/bad%20sid/objects/obj/threads/t1/debug/loops";
        const res = await app.handle(new Request(url));
        expect(res.status).toBe(400);
    });
});

/* ========================= loop debug single ========================= */

describe("GET /api/runtime/flows/:s/objects/:o/threads/:t/debug/loops/:i", () => {
    let worldRoot: string;
    const sessionId = "ses_debug02";
    const objectName = "supervisor";
    const threadId = "t_debug02";

    beforeAll(async () => {
        worldRoot = await makeTempWorld();
        const debugDir = path.join(
            worldRoot, "flows", sessionId, "objects", objectName,
            "threads", threadId, "debug",
        );
        await fs.mkdir(debugDir, { recursive: true });

        await fs.writeFile(
            path.join(debugDir, "loop_0000.meta.json"),
            JSON.stringify({ threadId, loopIndex: 0, status: "ok", startedAt: 1000, finishedAt: 1500, latencyMs: 500, messageCount: 2, toolCount: 3, toolCallCount: 1, contextBytes: 200, resultTextBytes: 50 }),
        );
        await fs.writeFile(
            path.join(debugDir, "loop_0000.input.json"),
            JSON.stringify({ threadId, inputItems: [{ type: "message", role: "user", content: "hello" }] }),
        );
        await fs.writeFile(
            path.join(debugDir, "loop_0000.output.json"),
            JSON.stringify({ threadId, outputItems: [{ type: "message", role: "assistant", content: "world" }] }),
        );
    });

    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("returns full loop data for index 0", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const url = `http://localhost/api/runtime/flows/${sessionId}/objects/${objectName}/threads/${threadId}/debug/loops/0`;
        const res = await app.handle(new Request(url));
        expect(res.status).toBe(200);
        const body = (await json(res)) as {
            ok: boolean;
            loopIndex: number;
            input: unknown;
            output: unknown;
            meta: unknown;
        };
        expect(body.ok).toBe(true);
        expect(body.loopIndex).toBe(0);
        expect(body.input).not.toBeNull();
        expect(body.output).not.toBeNull();
        expect(body.meta).not.toBeNull();
    });

    test("returns 404 for non-existent loop index", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const url = `http://localhost/api/runtime/flows/${sessionId}/objects/${objectName}/threads/${threadId}/debug/loops/99`;
        const res = await app.handle(new Request(url));
        expect(res.status).toBe(404);
    });

    test("returns 400 for invalid loop index", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const url = `http://localhost/api/runtime/flows/${sessionId}/objects/${objectName}/threads/${threadId}/debug/loops/evil`;
        const res = await app.handle(new Request(url));
        expect(res.status).toBe(400);
    });
});

/* ========================= permission HITL ========================= */

describe("POST /api/runtime/flows/:s/objects/:o/threads/:t/permission", () => {
    let worldRoot: string;
    const sessionId = "ses_perm01";
    const objectName = "supervisor";
    const threadId = "t_perm01";

    beforeAll(async () => {
        worldRoot = await makeTempWorld();
    });

    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    function makeRequest(body: unknown): Request {
        return new Request(
            `http://localhost/api/runtime/flows/${sessionId}/objects/${objectName}/threads/${threadId}/permission`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            },
        );
    }

    test("approve decision is recorded", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(makeRequest({ eventId: "evt_001", action: "approve" }));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; action: string; status: string };
        expect(body.ok).toBe(true);
        expect(body.action).toBe("approve");
        expect(body.status).toBe("approved");

        // Verify file was written to disk
        const file = path.join(
            worldRoot, "flows", sessionId, "objects", objectName,
            "threads", threadId, "permissions", "evt_001.json",
        );
        const raw = await fs.readFile(file, "utf8");
        const record = JSON.parse(raw) as { status: string; action: string };
        expect(record.status).toBe("approved");
        expect(record.action).toBe("approve");
    });

    test("reject decision is recorded", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(makeRequest({ eventId: "evt_002", action: "reject", reason: "unsafe" }));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; action: string; status: string };
        expect(body.ok).toBe(true);
        expect(body.action).toBe("reject");
        expect(body.status).toBe("rejected");
    });

    test("missing eventId → 400", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(makeRequest({ action: "approve" }));
        expect(res.status).toBe(400);
    });

    test("missing action → 400", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(makeRequest({ eventId: "evt_003" }));
        expect(res.status).toBe(400);
    });

    test("invalid action → 400", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(makeRequest({ eventId: "evt_004", action: "maybe" }));
        expect(res.status).toBe(400);
    });

    test("invalid sessionId → 400", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(
            new Request(
                "http://localhost/api/runtime/flows/bad%20sid/objects/obj/threads/t1/permission",
                { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: "e1", action: "approve" }) },
            ),
        );
        expect(res.status).toBe(400);
    });
});
