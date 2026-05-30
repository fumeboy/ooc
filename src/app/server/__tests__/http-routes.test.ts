/**
 * HTTP 控制面扩展路由单元测试 (P8)。
 *
 * 覆盖：
 * - GET /api/world
 * - GET /api/sessions（列表）
 * - GET /api/stones?branch=main
 * - GET /api/stones/:branch/:name
 * - GET /api/stones/:branch/:name/self
 * - GET /api/stones/:branch/:name/readme
 * - GET /api/stones/:branch/:name/server-source
 * - POST /api/stones/:branch/:name/call-method
 * - GET /api/flows/:sessionId/objects
 * - GET /api/flows/:sessionId/objects/:objectName
 * - GET /api/flows/:sessionId/objects/:objectName/threads/:threadId
 * - GET /api/tree
 * - GET /api/file/read
 * - GET /api/objects/:scope/:name/client-source-url
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../http";
import { Worker } from "@src/thinkable/worker";
import { ObjectRegistry } from "@src/executable/registry";
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

/** 创建临时 world 目录（测试隔离）。 */
async function makeTempWorld(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), "ooc-http-routes-test-"));
}

async function json(response: Response): Promise<unknown> {
    return response.json();
}

function makeWorker(worldRoot: string): Worker {
    return new Worker({ worldRoot, pollMs: 100 }, mockLlm, new ObjectRegistry());
}

/* ========================= /api/world ========================= */

describe("GET /api/world", () => {
    test("返回 worldRoot + branch", async () => {
        const worldRoot = "/tmp/ooc-test-world-cfg";
        const app = buildApp({ worker: makeWorker(worldRoot), branch: "main" });
        const res = await app.handle(new Request("http://localhost/api/world"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; worldRoot: string; branch: string };
        expect(body.ok).toBe(true);
        expect(body.worldRoot).toBe(worldRoot);
        expect(body.branch).toBe("main");
    });
});

/* ========================= /api/sessions (list) ========================= */

describe("GET /api/sessions", () => {
    let worldRoot: string;
    beforeAll(async () => {
        worldRoot = await makeTempWorld();
    });
    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("flows/ 不存在时返回空数组", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/sessions"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; sessions: unknown[] };
        expect(body.ok).toBe(true);
        expect(Array.isArray(body.sessions)).toBe(true);
    });

    test("有 flows/ 目录时列出 sessions", async () => {
        const flowsDir = path.join(worldRoot, "flows");
        await fs.mkdir(path.join(flowsDir, "ses_abc"), { recursive: true });
        await fs.mkdir(path.join(flowsDir, "ses_xyz"), { recursive: true });

        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/sessions"));
        const body = (await json(res)) as { ok: boolean; sessions: Array<{ sessionId: string }> };
        expect(body.ok).toBe(true);
        const ids = body.sessions.map((s) => s.sessionId);
        expect(ids).toContain("ses_abc");
        expect(ids).toContain("ses_xyz");
    });
});

/* ========================= /api/stones ========================= */

describe("GET /api/stones", () => {
    let worldRoot: string;
    beforeAll(async () => {
        worldRoot = await makeTempWorld();
        // 创建测试 stone
        const stoneDir = path.join(worldRoot, "stones", "main", "objects", "agent_test");
        await fs.mkdir(stoneDir, { recursive: true });
        await fs.writeFile(
            path.join(stoneDir, "self.md"),
            "---\nextends: root\ntitle: Agent Test\n---\n",
        );
    });
    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("列出 stones", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/stones?branch=main"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; stones: Array<{ name: string; uri: string }> };
        expect(body.ok).toBe(true);
        expect(body.stones.some((s) => s.name === "agent_test")).toBe(true);
        const stone = body.stones.find((s) => s.name === "agent_test")!;
        expect(stone.uri).toBe("ooc://stones/main/objects/agent_test");
    });

    test("无效 branch → 400", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/stones?branch=../evil"));
        expect(res.status).toBe(400);
    });
});

describe("GET /api/stones/:branch/:name", () => {
    let worldRoot: string;
    beforeAll(async () => {
        worldRoot = await makeTempWorld();
        const stoneDir = path.join(worldRoot, "stones", "main", "objects", "my_agent");
        await fs.mkdir(stoneDir, { recursive: true });
        await fs.writeFile(path.join(stoneDir, "self.md"), "---\nextends: root\ntitle: My Agent\n---\n");
        await fs.writeFile(path.join(stoneDir, "readme.md"), "# My Agent\nHello");
    });
    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("返回 stone 元数据", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/stones/main/my_agent"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as {
            ok: boolean; uri: string; self: string; readme: string | null; hasServer: boolean;
        };
        expect(body.ok).toBe(true);
        expect(body.uri).toBe("ooc://stones/main/objects/my_agent");
        expect(body.self).toContain("My Agent");
        expect(body.readme).toContain("Hello");
        expect(body.hasServer).toBe(false);
    });

    test("不存在的 stone → 404", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/stones/main/nonexistent"));
        expect(res.status).toBe(404);
    });

    test("路径穿越 → 400", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/stones/main/..%2Fevil"));
        expect(res.status).toBe(400);
    });
});

describe("GET /api/stones/:branch/:name/self", () => {
    let worldRoot: string;
    beforeAll(async () => {
        worldRoot = await makeTempWorld();
        const stoneDir = path.join(worldRoot, "stones", "main", "objects", "stone_a");
        await fs.mkdir(stoneDir, { recursive: true });
        await fs.writeFile(path.join(stoneDir, "self.md"), "---\nextends: root\n---\n");
    });
    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("返回 self.md 内容", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/stones/main/stone_a/self"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; content: string };
        expect(body.ok).toBe(true);
        expect(body.content).toContain("extends: root");
    });

    test("不存在 → 404", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/stones/main/nosuchstone/self"));
        expect(res.status).toBe(404);
    });
});

describe("GET /api/stones/:branch/:name/readme", () => {
    let worldRoot: string;
    beforeAll(async () => {
        worldRoot = await makeTempWorld();
        const stoneDir = path.join(worldRoot, "stones", "main", "objects", "stone_b");
        await fs.mkdir(stoneDir, { recursive: true });
        await fs.writeFile(path.join(stoneDir, "self.md"), "---\nextends: root\n---\n");
        await fs.writeFile(path.join(stoneDir, "readme.md"), "# Stone B");
    });
    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("返回 readme.md 内容", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/stones/main/stone_b/readme"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; content: string };
        expect(body.ok).toBe(true);
        expect(body.content).toContain("Stone B");
    });
});

describe("GET /api/stones/:branch/:name/server-source", () => {
    let worldRoot: string;
    beforeAll(async () => {
        worldRoot = await makeTempWorld();
        const stoneDir = path.join(worldRoot, "stones", "main", "objects", "stone_srv");
        await fs.mkdir(path.join(stoneDir, "server"), { recursive: true });
        await fs.writeFile(path.join(stoneDir, "self.md"), "---\nextends: root\n---\n");
        await fs.writeFile(path.join(stoneDir, "server", "index.ts"), "export default { public: {} };");
    });
    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("返回 server/index.ts 内容", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/stones/main/stone_srv/server-source"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; content: string };
        expect(body.ok).toBe(true);
        expect(body.content).toContain("export default");
    });

    test("无 server/index.ts → 404", async () => {
        const stoneDir = path.join(worldRoot, "stones", "main", "objects", "stone_nosrv");
        await fs.mkdir(stoneDir, { recursive: true });
        await fs.writeFile(path.join(stoneDir, "self.md"), "---\nextends: root\n---\n");

        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/stones/main/stone_nosrv/server-source"));
        expect(res.status).toBe(404);
    });
});

/* ========================= /api/flows ========================= */

describe("GET /api/flows/:sessionId/objects", () => {
    let worldRoot: string;
    beforeAll(async () => {
        worldRoot = await makeTempWorld();
        const flowDir = path.join(worldRoot, "flows", "ses_test1", "objects", "agent_x");
        await fs.mkdir(flowDir, { recursive: true });
    });
    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("列出 flow objects", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/flows/ses_test1/objects"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; objects: Array<{ name: string }> };
        expect(body.ok).toBe(true);
        expect(body.objects.some((o) => o.name === "agent_x")).toBe(true);
    });

    test("不存在的 session → 空数组", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/flows/nosuchsession/objects"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; objects: unknown[] };
        expect(body.ok).toBe(true);
        expect(body.objects).toHaveLength(0);
    });
});

describe("GET /api/flows/:sessionId/objects/:objectName", () => {
    let worldRoot: string;
    beforeAll(async () => {
        worldRoot = await makeTempWorld();
        const flowDir = path.join(worldRoot, "flows", "ses_obj_detail", "objects", "agent_y");
        await fs.mkdir(flowDir, { recursive: true });
        await fs.writeFile(path.join(flowDir, "plan.md"), "# Plan\nDo things");
        await fs.writeFile(path.join(flowDir, "todos.json"), JSON.stringify([{ id: "t1", text: "do task" }]));
    });
    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("返回 object 摘要（plan + todos）", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(
            new Request("http://localhost/api/flows/ses_obj_detail/objects/agent_y"),
        );
        expect(res.status).toBe(200);
        const body = (await json(res)) as {
            ok: boolean; plan: string | null; todos: unknown[];
        };
        expect(body.ok).toBe(true);
        expect(body.plan).toContain("Plan");
        expect(Array.isArray(body.todos)).toBe(true);
    });
});

describe("GET /api/flows/:sessionId/objects/:objectName/threads/:threadId", () => {
    let worldRoot: string;
    beforeAll(async () => {
        worldRoot = await makeTempWorld();
        // 写一个 thread.json 到磁盘
        const threadDir = path.join(
            worldRoot, "flows", "ses_thr", "objects", "agent_z", "threads", "t_123",
        );
        await fs.mkdir(threadDir, { recursive: true });
        await fs.writeFile(
            path.join(threadDir, "thread.json"),
            JSON.stringify({
                id: "t_123", sessionId: "ses_thr", objectUri: "ooc://stones/main/objects/agent_z",
                messages: [], status: "done", maxTicks: 5, ticks: 3,
            }),
        );
    });
    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("从磁盘恢复 thread", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(
            new Request("http://localhost/api/flows/ses_thr/objects/agent_z/threads/t_123"),
        );
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; source: string; thread: { id: string; status: string } };
        expect(body.ok).toBe(true);
        expect(body.source).toBe("disk");
        expect(body.thread.id).toBe("t_123");
        expect(body.thread.status).toBe("done");
    });

    test("不存在的 thread → 404", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(
            new Request("http://localhost/api/flows/ses_thr/objects/agent_z/threads/t_missing"),
        );
        expect(res.status).toBe(404);
    });
});

/* ========================= /api/tree ========================= */

describe("GET /api/tree", () => {
    let worldRoot: string;
    beforeAll(async () => {
        worldRoot = await makeTempWorld();
        await fs.mkdir(path.join(worldRoot, "flows"), { recursive: true });
        await fs.mkdir(path.join(worldRoot, "stones"), { recursive: true });
        await fs.writeFile(path.join(worldRoot, "test.txt"), "hello");
    });
    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("列出 worldRoot 条目（无 path 参数）", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/tree"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; entries: Array<{ name: string; type: string }> };
        expect(body.ok).toBe(true);
        expect(body.entries.some((e) => e.name === "flows" && e.type === "dir")).toBe(true);
        expect(body.entries.some((e) => e.name === "test.txt" && e.type === "file")).toBe(true);
    });

    test("列出子目录条目", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/tree?path=flows"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; entries: unknown[] };
        expect(body.ok).toBe(true);
    });

    test("路径穿越 → 400", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/tree?path=../../../etc"));
        expect(res.status).toBe(400);
    });
});

/* ========================= /api/file/read ========================= */

describe("GET /api/file/read", () => {
    let worldRoot: string;
    beforeAll(async () => {
        worldRoot = await makeTempWorld();
        await fs.writeFile(path.join(worldRoot, "hello.txt"), "Hello OOC");
    });
    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("读取文件内容", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/file/read?path=hello.txt"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; content: string };
        expect(body.ok).toBe(true);
        expect(body.content).toBe("Hello OOC");
    });

    test("缺 path 参数 → 400", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/file/read"));
        expect(res.status).toBe(400);
    });

    test("不存在文件 → 404", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/file/read?path=nosuchfile.txt"));
        expect(res.status).toBe(404);
    });

    test("路径穿越 → 404", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(
            new Request("http://localhost/api/file/read?path=../../../etc/passwd"),
        );
        expect(res.status).toBe(404);
    });
});

/* ========================= /api/objects client-source-url ========================= */

describe("GET /api/objects/:scope/:name/client-source-url", () => {
    let worldRoot: string;
    beforeAll(async () => {
        worldRoot = await makeTempWorld();
        // stone with client
        const clientDir = path.join(worldRoot, "stones", "main", "objects", "vis_agent", "client");
        await fs.mkdir(clientDir, { recursive: true });
        await fs.writeFile(path.join(clientDir, "index.tsx"), "export default function() {}");
        // stone without client
        const noClientDir = path.join(worldRoot, "stones", "main", "objects", "no_client");
        await fs.mkdir(noClientDir, { recursive: true });
    });
    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("有 client/index.tsx → 返回 /@fs URL", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(
            new Request("http://localhost/api/objects/main/vis_agent/client-source-url"),
        );
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; url: string | null };
        expect(body.ok).toBe(true);
        expect(typeof body.url).toBe("string");
        expect(body.url).toContain("/@fs");
        expect(body.url).toContain("index.tsx");
    });

    test("无 client → url: null", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(
            new Request("http://localhost/api/objects/main/no_client/client-source-url"),
        );
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; url: null };
        expect(body.ok).toBe(true);
        expect(body.url).toBeNull();
    });
});

/* ========================= /api/tree depth ========================= */

describe("GET /api/tree with depth param", () => {
    let worldRoot: string;
    beforeAll(async () => {
        worldRoot = await makeTempWorld();
        // Create nested structure: a/b/c.txt
        await fs.mkdir(path.join(worldRoot, "a", "b"), { recursive: true });
        await fs.writeFile(path.join(worldRoot, "a", "b", "c.txt"), "hello");
        await fs.writeFile(path.join(worldRoot, "a", "top.txt"), "top");
    });
    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("depth=0 returns flat entries (no children)", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/tree?path=a&depth=0"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; entries: Array<{ name: string; type: string }>; root?: unknown };
        expect(body.ok).toBe(true);
        expect(Array.isArray(body.entries)).toBe(true);
        // root absent for depth=0
        expect(body.root).toBeUndefined();
    });

    test("depth=2 returns nested tree", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/tree?path=a&depth=2"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as {
            ok: boolean;
            root?: { children: Array<{ name: string; type: string; children?: unknown[] }> };
        };
        expect(body.ok).toBe(true);
        expect(body.root).toBeDefined();
        expect(Array.isArray(body.root?.children)).toBe(true);
        const bDir = body.root?.children?.find((c) => c.name === "b" && c.type === "dir");
        expect(bDir).toBeDefined();
        expect(Array.isArray(bDir?.children)).toBe(true);
    });

    test("recursive=true returns deep tree", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/tree?path=a&recursive=true"));
        const body = (await json(res)) as { ok: boolean; root?: { children: unknown[] } };
        expect(body.ok).toBe(true);
        expect(body.root?.children?.length).toBeGreaterThan(0);
    });
});

/* ========================= /api/flows rich list ========================= */

describe("GET /api/flows", () => {
    let worldRoot: string;
    beforeAll(async () => {
        worldRoot = await makeTempWorld();
        const flowsDir = path.join(worldRoot, "flows", "ses_test1");
        await fs.mkdir(flowsDir, { recursive: true });
        await fs.writeFile(
            path.join(flowsDir, ".session.json"),
            JSON.stringify({ createdAt: new Date().toISOString(), objectUri: "ooc://stones/main/objects/supervisor", title: "Test Session" }),
        );
    });
    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("returns items array with title and timestamps", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/flows"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as {
            ok: boolean;
            items: Array<{ sessionId: string; title: string; createdAt: number; updatedAt: number }>;
            hash: string;
        };
        expect(body.ok).toBe(true);
        expect(Array.isArray(body.items)).toBe(true);
        const item = body.items.find((i) => i.sessionId === "ses_test1");
        expect(item).toBeDefined();
        expect(item?.title).toBe("Test Session");
        expect(typeof item?.createdAt).toBe("number");
        expect(typeof item?.updatedAt).toBe("number");
        expect(typeof body.hash).toBe("string");
    });
});

/* ========================= /api/flows/:sid/threads ========================= */

describe("GET /api/flows/:sessionId/threads", () => {
    let worldRoot: string;
    beforeAll(async () => {
        worldRoot = await makeTempWorld();
        // Create a thread.json on disk
        const threadDir = path.join(worldRoot, "flows", "ses_t1", "objects", "supervisor", "threads", "t_abc123");
        await fs.mkdir(threadDir, { recursive: true });
        await fs.writeFile(
            path.join(threadDir, "thread.json"),
            JSON.stringify({ id: "t_abc123", sessionId: "ses_t1", objectUri: "ooc://stones/main/objects/supervisor", status: "done", messages: [], maxTicks: 5, ticks: 5 }),
        );
    });
    afterAll(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("returns disk threads for session", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/flows/ses_t1/threads"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; items: Array<{ objectId: string; threadId: string; status?: string }> };
        expect(body.ok).toBe(true);
        expect(Array.isArray(body.items)).toBe(true);
        const item = body.items.find((i) => i.threadId === "t_abc123");
        expect(item).toBeDefined();
        expect(item?.objectId).toBe("supervisor");
        expect(item?.status).toBe("done");
    });

    test("invalid sessionId (special chars) returns 400", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/flows/bad%20id%21here/threads"));
        expect(res.status).toBe(400);
    });
});

/* ========================= /api/flows/:sid/pause + resume ========================= */

describe("POST /api/flows/:sessionId/pause and /resume", () => {
    let worldRoot: string;
    beforeAll(async () => { worldRoot = await makeTempWorld(); });
    afterAll(async () => { await fs.rm(worldRoot, { recursive: true, force: true }); });

    test("pause returns paused: true", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(
            new Request("http://localhost/api/flows/ses_abc/pause", { method: "POST" }),
        );
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; paused: boolean };
        expect(body.ok).toBe(true);
        expect(body.paused).toBe(true);
    });

    test("resume returns paused: false", async () => {
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(
            new Request("http://localhost/api/flows/ses_abc/resume", { method: "POST" }),
        );
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; paused: boolean; jobIds: string[] };
        expect(body.ok).toBe(true);
        expect(body.paused).toBe(false);
        expect(Array.isArray(body.jobIds)).toBe(true);
    });
});

/* ========================= /api/runtime/jobs/:jobId ========================= */

describe("GET /api/runtime/jobs/:jobId", () => {
    test("unknown jobId returns status: done (synthetic)", async () => {
        const worldRoot = await makeTempWorld();
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(
            new Request("http://localhost/api/runtime/jobs/t_nonexistent"),
        );
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; status: string };
        expect(body.ok).toBe(true);
        expect(body.status).toBe("done");
        await fs.rm(worldRoot, { recursive: true, force: true });
    });
});

/* ========================= /api/world/config ========================= */

describe("GET /api/world/config", () => {
    test("returns default siteName when no .world.json", async () => {
        const worldRoot = await makeTempWorld();
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/world/config"));
        expect(res.status).toBe(200);
        const body = (await json(res)) as { ok: boolean; siteName: string; worldRoot: string };
        expect(body.ok).toBe(true);
        expect(typeof body.siteName).toBe("string");
        expect(body.siteName.length).toBeGreaterThan(0);
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("returns custom siteName from .world.json", async () => {
        const worldRoot = await makeTempWorld();
        await fs.writeFile(
            path.join(worldRoot, ".world.json"),
            JSON.stringify({ siteName: "My OOC World" }),
        );
        const app = buildApp({ worker: makeWorker(worldRoot) });
        const res = await app.handle(new Request("http://localhost/api/world/config"));
        const body = (await json(res)) as { siteName: string };
        expect(body.siteName).toBe("My OOC World");
        await fs.rm(worldRoot, { recursive: true, force: true });
    });
});
