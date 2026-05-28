import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import rootServer from "../server/index";
import { ObjectRegistry } from "@src/executable/registry";
import type { ObjectRecord } from "@src/persistable/object-record";
import type { ObjectContext } from "@src/executable/server";

describe("root.todo_*", () => {
    let world: string;
    const sessionId = "s_todo";
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

    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-todo-test-"));
    });
    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    async function readTodos(): Promise<any[]> {
        try {
            const body = await fs.readFile(
                path.join(world, "flows", sessionId, "objects", "agent_a", "todos.json"),
                "utf8",
            );
            return JSON.parse(body).items;
        } catch { return []; }
    }

    test("todo_add 写入 todos.json", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.todo_add!({ content: "Do thing" } as any, ctx)) as any;
        expect(r.ok).toBe(true);
        expect(r.id).toMatch(/^td_/);
        const items = await readTodos();
        expect(items).toHaveLength(1);
        expect(items[0].content).toBe("Do thing");
        expect(items[0].checked).toBe(false);
    });

    test("todo_check 标记 checked=true", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.todo_add!({ content: "X" } as any, ctx)) as any;
        await rootServer.public.todo_check!({ id: r.id } as any, ctx);
        const items = await readTodos();
        expect(items[0].checked).toBe(true);
    });

    test("todo_uncheck 标记 checked=false", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.todo_add!({ content: "X" } as any, ctx)) as any;
        await rootServer.public.todo_check!({ id: r.id } as any, ctx);
        await rootServer.public.todo_uncheck!({ id: r.id } as any, ctx);
        const items = await readTodos();
        expect(items[0].checked).toBe(false);
    });

    test("todo_remove 删除 item", async () => {
        const ctx = makeCtx();
        const r1 = (await rootServer.public.todo_add!({ content: "A" } as any, ctx)) as any;
        const r2 = (await rootServer.public.todo_add!({ content: "B" } as any, ctx)) as any;
        await rootServer.public.todo_remove!({ id: r1.id } as any, ctx);
        const items = await readTodos();
        expect(items).toHaveLength(1);
        expect(items[0].id).toBe(r2.id);
    });

    test("todo_list 返回所有 items", async () => {
        const ctx = makeCtx();
        await rootServer.public.todo_add!({ content: "A" } as any, ctx);
        await rootServer.public.todo_add!({ content: "B" } as any, ctx);
        const r = (await rootServer.public.todo_list!({} as any, ctx)) as any;
        expect(r.items).toHaveLength(2);
    });

    test("todo_list 空 → 空数组", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.todo_list!({} as any, ctx)) as any;
        expect(r.items).toEqual([]);
    });
});
