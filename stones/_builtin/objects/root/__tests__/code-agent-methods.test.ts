import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import rootServer from "../server/index";
import { ObjectRegistry } from "@src/executable/registry";
import type { ObjectRecord } from "@src/persistable/object-record";
import type { ObjectContext } from "@src/executable/server";

describe("root code-agent A-class methods", () => {
    let world: string;
    function makeCtx(): ObjectContext {
        const reg = new ObjectRegistry();
        const rec: ObjectRecord = {
            uri: "ooc://stones/main/objects/agent_a",
            paths: { stone: "/tmp" },
            kind: "persistent",
            self: {},
        };
        reg.set(rec);
        return { record: rec, worldRoot: world, sessionId: "s", registry: reg };
    }
    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-code-agent-"));
    });
    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    test("write_file then open_file roundtrip", async () => {
        const ctx = makeCtx();
        const target = path.join(world, "x.txt");
        await rootServer.public.write_file!({ path: target, content: "hello" } as any, ctx);
        const r = (await rootServer.public.open_file!({ path: target } as any, ctx)) as any;
        expect(r.content).toBe("hello");
        expect(r.bytes).toBe(5);
    });

    test("write_file rejects absolute path outside stone dir", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.write_file!({ path: "/etc/passwd-fake", content: "x" } as any, ctx),
        ).rejects.toThrow(/stone dir/);
    });

    test("write_file rejects relative path outside worldRoot", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.write_file!({ path: "../escape", content: "x" } as any, ctx),
        ).rejects.toThrow(/outside worldRoot/);
    });

    test("open_file rejects path outside worldRoot", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.open_file!({ path: "/etc/hosts" } as any, ctx),
        ).rejects.toThrow(/outside worldRoot/);
    });

    test("grep finds pattern across files", async () => {
        const ctx = makeCtx();
        await fs.writeFile(path.join(world, "a.txt"), "hello world\nfoo bar\n");
        await fs.writeFile(path.join(world, "b.txt"), "hello again\n");
        const r = (await rootServer.public.grep!({ pattern: "hello" } as any, ctx)) as any;
        expect(r.count).toBe(2);
    });

    test("grep rejects path outside worldRoot", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.grep!({ pattern: "foo", path: "/etc" } as any, ctx),
        ).rejects.toThrow(/outside worldRoot/);
    });

    test("glob finds files matching extension", async () => {
        const ctx = makeCtx();
        await fs.writeFile(path.join(world, "a.ts"), "");
        await fs.writeFile(path.join(world, "b.ts"), "");
        await fs.writeFile(path.join(world, "c.txt"), "");
        const r = (await rootServer.public.glob!({ pattern: "*.ts" } as any, ctx)) as any;
        expect(r.count).toBe(2);
    });

    test("glob with **/pattern finds nested files", async () => {
        const ctx = makeCtx();
        await fs.mkdir(path.join(world, "sub"), { recursive: true });
        await fs.writeFile(path.join(world, "root.ts"), "");
        await fs.writeFile(path.join(world, "sub", "nested.ts"), "");
        await fs.writeFile(path.join(world, "other.txt"), "");
        const r = (await rootServer.public.glob!({ pattern: "**/*.ts" } as any, ctx)) as any;
        expect(r.count).toBe(2);
    });

    test("glob rejects path outside worldRoot", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.glob!({ pattern: "*.txt", path: "/etc" } as any, ctx),
        ).rejects.toThrow(/outside worldRoot/);
    });

    test("open_file truncates large content", async () => {
        const ctx = makeCtx();
        const big = "x".repeat(60_000);
        await fs.writeFile(path.join(world, "big.txt"), big);
        const r = (await rootServer.public.open_file!({ path: path.join(world, "big.txt") } as any, ctx)) as any;
        expect(r.truncated).toBe(true);
        expect(r.content.length).toBe(50_000);
    });

    test("write_file creates parent directories", async () => {
        const ctx = makeCtx();
        const target = path.join(world, "deep", "nested", "file.txt");
        const r = (await rootServer.public.write_file!({ path: target, content: "deep" } as any, ctx)) as any;
        expect(r.ok).toBe(true);
        const body = await fs.readFile(target, "utf8");
        expect(body).toBe("deep");
    });
});
