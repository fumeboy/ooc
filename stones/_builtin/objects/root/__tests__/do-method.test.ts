import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import rootServer from "../server/index";
import { ObjectRegistry } from "@src/executable/registry";
import type { ObjectRecord } from "@src/persistable/object-record";
import type { ObjectContext } from "@src/executable/server";

describe("root.do + do_close", () => {
    let world: string;
    const sessionId = "s_do_test";

    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-do-test-"));
    });
    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    function makeCtx(): ObjectContext {
        const reg = new ObjectRegistry();
        const rec: ObjectRecord = {
            uri: "ooc://stones/main/objects/agent_a",
            paths: { stone: "/tmp" },
            kind: "persistent",
            self: {},
        };
        reg.set(rec);
        return { record: rec, worldRoot: world, sessionId, registry: reg };
    }

    test("do 创建 threads/<id>/ 目录与 intent.md + thread.json", async () => {
        const ctx = makeCtx();
        const result = (await rootServer.public.do!(
            { intent: "搞清楚 X" } as any,
            ctx,
        )) as { ok: boolean; thread_id: string };
        expect(result.ok).toBe(true);
        expect(result.thread_id).toMatch(/^t_[0-9a-f]+/);
        const dir = path.join(world, "flows", sessionId, "objects", "agent_a", "threads", result.thread_id);
        const intent = await fs.readFile(path.join(dir, "intent.md"), "utf8");
        expect(intent).toContain("搞清楚 X");
        const thread = JSON.parse(await fs.readFile(path.join(dir, "thread.json"), "utf8"));
        expect(thread.status).toBe("active");
    });

    test("do with parent_thread_id 字段写入 intent.md", async () => {
        const ctx = makeCtx();
        const result = (await rootServer.public.do!(
            { intent: "嵌套", parent_thread_id: "t_parent" } as any,
            ctx,
        )) as { thread_id: string };
        const intent = await fs.readFile(
            path.join(world, "flows", sessionId, "objects", "agent_a", "threads", result.thread_id, "intent.md"),
            "utf8",
        );
        expect(intent).toContain("parent_thread_id");
        expect(intent).toContain("t_parent");
    });

    test("do_close 将 thread.json status 标 closed", async () => {
        const ctx = makeCtx();
        const created = (await rootServer.public.do!({ intent: "x" } as any, ctx)) as { thread_id: string };
        await rootServer.public.do_close!({ thread_id: created.thread_id } as any, ctx);
        const thread = JSON.parse(
            await fs.readFile(
                path.join(world, "flows", sessionId, "objects", "agent_a", "threads", created.thread_id, "thread.json"),
                "utf8",
            ),
        );
        expect(thread.status).toBe("closed");
        expect(thread.closed_at).toBeDefined();
    });

    test("do_close 对不存在 thread 抛错", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.do_close!({ thread_id: "t_missing" } as any, ctx),
        ).rejects.toThrow(/not found/);
    });

    test("do 多次 spawn 在 threads/ 同层（扁平）", async () => {
        const ctx = makeCtx();
        const r1 = (await rootServer.public.do!({ intent: "a" } as any, ctx)) as { thread_id: string };
        const r2 = (await rootServer.public.do!({ intent: "b" } as any, ctx)) as { thread_id: string };
        expect(r1.thread_id).not.toBe(r2.thread_id);
        const threadsRoot = path.join(world, "flows", sessionId, "objects", "agent_a", "threads");
        const entries = await fs.readdir(threadsRoot, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        expect(dirs.sort()).toEqual([r1.thread_id, r2.thread_id].sort());
    });
});
