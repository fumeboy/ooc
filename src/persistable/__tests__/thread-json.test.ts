/**
 * thread-json: readThread / writeThread 单元测试。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
    readThread,
    writeThread,
    threadJsonPath,
    objectNameFromUri,
} from "@src/persistable/thread-json";
import type { ThinkThread } from "@src/thinkable/think-thread";

function makeTempDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), "ooc-thread-json-test-"));
}

function sampleThread(overrides: Partial<ThinkThread> = {}): ThinkThread {
    return {
        id: "t_test01",
        sessionId: "ses_abc",
        objectUri: "ooc://stones/main/objects/agent_a",
        messages: [
            { type: "message" as const, role: "system" as const, content: "You are an agent." },
            { type: "message" as const, role: "user" as const, content: "Hello" },
        ],
        status: "done",
        maxTicks: 5,
        ticks: 2,
        ...overrides,
    };
}

/* ============== objectNameFromUri ============== */

describe("objectNameFromUri", () => {
    test("persistent Object URI", () => {
        expect(objectNameFromUri("ooc://stones/main/objects/foo")).toBe("foo");
    });
    test("ephemeral Object URI", () => {
        expect(objectNameFromUri("ooc://flows/ses_x/objects/bar")).toBe("bar");
    });
    test("nested child URI", () => {
        expect(objectNameFromUri("ooc://stones/main/objects/parent/children/child")).toBe("child");
    });
});

/* ============== threadJsonPath ============== */

describe("threadJsonPath", () => {
    test("构造正确路径", () => {
        const p = threadJsonPath("/world", "ses_abc", "agent_a", "t_001");
        expect(p).toBe("/world/flows/ses_abc/objects/agent_a/threads/t_001/thread.json");
    });
});

/* ============== readThread / writeThread ============== */

describe("writeThread + readThread roundtrip", () => {
    let worldRoot: string;

    beforeEach(async () => {
        worldRoot = await makeTempDir();
    });

    afterEach(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("write 然后 read 得到相同 thread", async () => {
        const thread = sampleThread();
        await writeThread(thread, worldRoot);

        const loaded = await readThread(worldRoot, "ses_abc", "agent_a", "t_test01");
        expect(loaded).not.toBeNull();
        expect(loaded!.id).toBe(thread.id);
        expect(loaded!.sessionId).toBe(thread.sessionId);
        expect(loaded!.objectUri).toBe(thread.objectUri);
        expect(loaded!.status).toBe(thread.status);
        expect(loaded!.ticks).toBe(thread.ticks);
        expect(loaded!.messages).toHaveLength(thread.messages.length);
    });

    test("writeThread 自动创建父目录", async () => {
        const thread = sampleThread({ id: "t_new", sessionId: "ses_new" });
        // 目录不存在 → write 应自动创建
        await writeThread(thread, worldRoot);
        const filePath = threadJsonPath(worldRoot, "ses_new", "agent_a", "t_new");
        const stat = await fs.stat(filePath);
        expect(stat.isFile()).toBe(true);
    });

    test("readThread: 文件不存在返回 null", async () => {
        const result = await readThread(worldRoot, "ses_missing", "agent_x", "t_missing");
        expect(result).toBeNull();
    });

    test("readThread: 损坏的 JSON 返回 null", async () => {
        const dir = path.join(worldRoot, "flows", "ses_corrupt", "objects", "agent_c", "threads", "t_bad");
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "thread.json"), "{ this is not valid json");

        const result = await readThread(worldRoot, "ses_corrupt", "agent_c", "t_bad");
        expect(result).toBeNull();
    });

    test("readThread: 缺 id 字段的 JSON 返回 null", async () => {
        const dir = path.join(worldRoot, "flows", "ses_bad_schema", "objects", "agent_d", "threads", "t_x");
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(
            path.join(dir, "thread.json"),
            JSON.stringify({ sessionId: "ses_bad_schema", messages: [] }),
        );
        const result = await readThread(worldRoot, "ses_bad_schema", "agent_d", "t_x");
        expect(result).toBeNull();
    });

    test("多次 writeThread 覆盖前版本（最终读到最新状态）", async () => {
        const thread = sampleThread({ status: "running", ticks: 0 });
        await writeThread(thread, worldRoot);

        // 模拟 tick 推进
        thread.ticks = 3;
        thread.status = "done";
        thread.messages.push({ type: "message" as const, role: "assistant" as const, content: "Done!" });
        await writeThread(thread, worldRoot);

        const loaded = await readThread(worldRoot, "ses_abc", "agent_a", "t_test01");
        expect(loaded!.ticks).toBe(3);
        expect(loaded!.status).toBe("done");
        expect(loaded!.messages).toHaveLength(3);
    });

    test("writeThread 原子性：.tmp 文件在 rename 后不残留", async () => {
        const thread = sampleThread();
        await writeThread(thread, worldRoot);
        const filePath = threadJsonPath(worldRoot, "ses_abc", "agent_a", "t_test01");
        const tmpPath = filePath + ".tmp";
        let tmpExists = true;
        try {
            await fs.stat(tmpPath);
        } catch {
            tmpExists = false;
        }
        expect(tmpExists).toBe(false);
        // 正式文件存在
        expect((await fs.stat(filePath)).isFile()).toBe(true);
    });
});

/* ============== Worker resume integration ============== */

describe("Worker.resumeFromDisk", () => {
    let worldRoot: string;

    beforeEach(async () => {
        worldRoot = await makeTempDir();
    });

    afterEach(async () => {
        await fs.rm(worldRoot, { recursive: true, force: true });
    });

    test("磁盘有 thread.json → resume 后加入 queue", async () => {
        const { Worker } = await import("@src/thinkable/worker");
        const { ObjectRegistry } = await import("@src/executable/registry");
        const mockLlm = {
            async generate() {
                return { provider: "claude" as const, model: "test", outputItems: [], text: "OK", toolCalls: [] };
            },
            stream: async function* () {},
        };
        const worker = new Worker({ worldRoot, pollMs: 100 }, mockLlm, new ObjectRegistry());

        // 预写 thread 到磁盘
        const thread = sampleThread({ id: "t_resume1", sessionId: "ses_r1", status: "done", ticks: 5 });
        await writeThread(thread, worldRoot);

        // resumeFromDisk
        const loaded = await worker.resumeFromDisk("ses_r1", "agent_a", "t_resume1");
        expect(loaded).not.toBeNull();
        expect(loaded!.id).toBe("t_resume1");
        expect(loaded!.ticks).toBe(5);
        expect(worker.get("t_resume1")).toBeDefined();
    });

    test("磁盘无 thread.json → resumeFromDisk 返回 null", async () => {
        const { Worker } = await import("@src/thinkable/worker");
        const { ObjectRegistry } = await import("@src/executable/registry");
        const mockLlm = {
            async generate() {
                return { provider: "claude" as const, model: "test", outputItems: [], text: "OK", toolCalls: [] };
            },
            stream: async function* () {},
        };
        const worker = new Worker({ worldRoot, pollMs: 100 }, mockLlm, new ObjectRegistry());

        const loaded = await worker.resumeFromDisk("ses_missing", "agent_b", "t_notexist");
        expect(loaded).toBeNull();
    });
});
