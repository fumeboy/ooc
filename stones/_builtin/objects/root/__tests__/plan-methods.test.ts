import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import rootServer from "../server/index";
import { ObjectRegistry } from "@src/executable/registry";
import type { ObjectRecord } from "@src/persistable/object-record";
import type { ObjectContext } from "@src/executable/server";

describe("root.plan_*", () => {
    let world: string;
    const sessionId = "s_plan";

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
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-plan-test-"));
    });
    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    test("plan_set 写入 plan.md", async () => {
        const ctx = makeCtx();
        await rootServer.public.plan_set!({ text: "My plan text" } as any, ctx);
        const body = await fs.readFile(
            path.join(world, "flows", sessionId, "objects", "agent_a", "plan.md"),
            "utf8",
        );
        expect(body).toBe("My plan text");
    });

    test("plan_set 覆盖之前内容", async () => {
        const ctx = makeCtx();
        await rootServer.public.plan_set!({ text: "v1" } as any, ctx);
        await rootServer.public.plan_set!({ text: "v2" } as any, ctx);
        const body = await fs.readFile(
            path.join(world, "flows", sessionId, "objects", "agent_a", "plan.md"),
            "utf8",
        );
        expect(body).toBe("v2");
    });

    test("plan_clear 删除 plan.md", async () => {
        const ctx = makeCtx();
        await rootServer.public.plan_set!({ text: "x" } as any, ctx);
        await rootServer.public.plan_clear!({} as any, ctx);
        await expect(
            fs.access(path.join(world, "flows", sessionId, "objects", "agent_a", "plan.md")),
        ).rejects.toThrow();
    });

    test("plan_clear 当没有 plan.md 也不抛错", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.plan_clear!({} as any, ctx)) as any;
        expect(r.ok).toBe(true);
    });
});
