import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { defaultContext } from "../server/index";
import { ObjectRegistry } from "@src/executable/registry";
import type { ObjectContext } from "@src/executable/server";
import type { ObjectRecord } from "@src/persistable/object-record";

async function write(p: string, body: string) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
}

function makeCtx(world: string, sessionId: string, selfUri: string): ObjectContext {
    const registry = new ObjectRegistry();
    const self_record: ObjectRecord = {
        uri: selfUri,
        paths: {
            stone: path.join(world, "stones", "main", "objects", "agent_a"),
            pool: path.join(world, "pools", "objects", "agent_a"),
            flow: path.join(world, "flows", sessionId, "objects", "agent_a"),
        },
        kind: "persistent",
        self: { extends: "root" },
    };
    registry.set(self_record);
    return {
        record: self_record,
        worldRoot: world,
        sessionId,
        registry,
    };
}

describe("root.defaultContext()", () => {
    let world: string;

    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-default-ctx-"));
    });

    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    test("空 flow + 空 stone → 仅 relations 切片 (siblings/children 空)", async () => {
        const ctx = makeCtx(world, "s_test", "ooc://stones/main/objects/agent_a");
        const slices = await defaultContext(ctx);
        expect(slices).toHaveLength(1);
        expect(slices[0].kind).toBe("relations");
        const rel = slices[0].payload as { siblings: string[]; children: string[] };
        expect(rel.siblings).toEqual([]);
        expect(rel.children).toEqual([]);
    });

    test("active plan 非空 → plan 切片", async () => {
        const ctx = makeCtx(world, "s_test", "ooc://stones/main/objects/agent_a");
        await write(path.join(ctx.record.paths.flow!, "plan.md"), "我的当前 plan");
        const slices = await defaultContext(ctx);
        const plan = slices.find((s) => s.kind === "plan");
        expect(plan).toBeDefined();
        expect(plan!.payload).toBe("我的当前 plan");
    });

    test("unfinished todos → todos 切片只列 unchecked", async () => {
        const ctx = makeCtx(world, "s_test", "ooc://stones/main/objects/agent_a");
        await write(
            path.join(ctx.record.paths.flow!, "todos.json"),
            JSON.stringify({
                items: [
                    { id: "t1", content: "done thing", checked: true },
                    { id: "t2", content: "pending thing", checked: false },
                ],
            }),
        );
        const slices = await defaultContext(ctx);
        const todos = slices.find((s) => s.kind === "todos");
        expect(todos).toBeDefined();
        const items = todos!.payload as Array<{ id: string }>;
        expect(items).toHaveLength(1);
        expect(items[0].id).toBe("t2");
    });

    test("active threads (open) appears; closed 不appears", async () => {
        const ctx = makeCtx(world, "s_test", "ooc://stones/main/objects/agent_a");
        await write(
            path.join(ctx.record.paths.flow!, "threads", "t_open", "thread.json"),
            JSON.stringify({ status: "active" }),
        );
        await write(
            path.join(ctx.record.paths.flow!, "threads", "t_done", "thread.json"),
            JSON.stringify({ status: "closed" }),
        );
        const slices = await defaultContext(ctx);
        const threads = slices.find((s) => s.kind === "threads");
        expect(threads).toBeDefined();
        const active = threads!.payload as string[];
        expect(active).toEqual(["t_open"]);
    });

    test("recent talks per peer", async () => {
        const ctx = makeCtx(world, "s_test", "ooc://stones/main/objects/agent_a");
        await write(
            path.join(ctx.record.paths.flow!, "talks", "agent_b.jsonl"),
            ['{"direction":"out","content":"hi"}', '{"direction":"in","content":"hello"}'].join("\n"),
        );
        const slices = await defaultContext(ctx);
        const talks = slices.find((s) => s.kind === "talks");
        expect(talks).toBeDefined();
        const arr = talks!.payload as Array<{ peer: string; lastLines: string[] }>;
        expect(arr).toHaveLength(1);
        expect(arr[0].peer).toBe("agent_b");
        expect(arr[0].lastLines).toHaveLength(2);
    });

    test("relations: siblings 与 children 来自 registry", async () => {
        const ctx = makeCtx(world, "s_test", "ooc://stones/main/objects/agent_a");
        // 加同级 sibling
        ctx.registry.set({
            uri: "ooc://stones/main/objects/agent_b",
            paths: { stone: "/tmp/x" },
            kind: "persistent",
            self: {},
        });
        // 加 child
        ctx.registry.set({
            uri: "ooc://stones/main/objects/agent_a/children/sub_1",
            paths: { stone: "/tmp/y" },
            kind: "persistent",
            self: {},
        });
        const slices = await defaultContext(ctx);
        const rel = slices.find((s) => s.kind === "relations");
        const r = rel!.payload as { siblings: string[]; children: string[] };
        expect(r.siblings).toContain("ooc://stones/main/objects/agent_b");
        expect(r.children).toContain("ooc://stones/main/objects/agent_a/children/sub_1");
    });

    test("无 flow path → 仅 relations 切片", async () => {
        const ctx: ObjectContext = {
            record: {
                uri: "ooc://stones/main/objects/x",
                paths: { stone: "/tmp" },
                kind: "persistent",
                self: {},
            },
            worldRoot: world,
            registry: new ObjectRegistry(),
        };
        const slices = await defaultContext(ctx);
        expect(slices).toHaveLength(1);
        expect(slices[0].kind).toBe("relations");
    });

    test("pool_memory: 有 .md 文件 → pool_memory 切片", async () => {
        const ctx = makeCtx(world, "s_test", "ooc://stones/main/objects/agent_a");
        const memDir = path.join(world, "pools", "objects", "agent_a", "knowledge", "memory");
        await write(path.join(memDir, "fav-color.md"), "My favorite color is octarine.");
        await write(path.join(memDir, "note.md"), "Remember to greet users warmly.");
        const slices = await defaultContext(ctx);
        const pm = slices.find((s) => s.kind === "pool_memory");
        expect(pm).toBeDefined();
        const items = pm!.payload as Array<{ slug: string; content: string }>;
        expect(items.length).toBe(2);
        const favColor = items.find((i) => i.slug === "fav-color");
        expect(favColor).toBeDefined();
        expect(favColor!.content).toBe("My favorite color is octarine.");
    });

    test("pool_memory: 目录不存在 → 无 pool_memory 切片", async () => {
        const ctx = makeCtx(world, "s_test", "ooc://stones/main/objects/agent_a");
        const slices = await defaultContext(ctx);
        expect(slices.find((s) => s.kind === "pool_memory")).toBeUndefined();
    });

    test("pool_memory: 使用 ctx.record.paths.pool 合成路径", async () => {
        const ctx = makeCtx(world, "s_test", "ooc://stones/main/objects/agent_a");
        // Override pool path
        const customPool = path.join(world, "custom-pool");
        (ctx.record.paths as { pool?: string }).pool = customPool;
        const memDir = path.join(customPool, "knowledge", "memory");
        await write(path.join(memDir, "custom.md"), "Custom pool content.");
        const slices = await defaultContext(ctx);
        const pm = slices.find((s) => s.kind === "pool_memory");
        expect(pm).toBeDefined();
        const items = pm!.payload as Array<{ slug: string; content: string }>;
        const custom = items.find((i) => i.slug === "custom");
        expect(custom).toBeDefined();
        expect(custom!.content).toBe("Custom pool content.");
    });
});
