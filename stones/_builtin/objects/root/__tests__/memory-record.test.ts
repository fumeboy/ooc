import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import rootServer from "../server/index";
import { ObjectRegistry } from "@src/executable/registry";
import type { ObjectRecord } from "@src/persistable/object-record";
import type { ObjectContext } from "@src/executable/server";

describe("root.memory_record", () => {
    let world: string;
    const sessionId = "s_mem";

    function makeCtx(poolPath?: string): ObjectContext {
        const reg = new ObjectRegistry();
        const rec: ObjectRecord = {
            uri: "ooc://stones/main/objects/agent_a",
            paths: {
                stone: path.join(world, "stones", "main", "objects", "agent_a"),
                pool: poolPath,
            },
            kind: "persistent",
            self: {},
        };
        reg.set(rec);
        return { record: rec, worldRoot: world, sessionId, registry: reg };
    }

    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-mem-test-"));
    });
    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    test("writes .md file to synthesized pool memory dir", async () => {
        const ctx = makeCtx();
        const result = (await rootServer.public.memory_record!(
            { slug: "fav-color", content: "My favorite color is octarine." },
            ctx,
        )) as { ok: boolean; slug: string; path: string };

        expect(result.ok).toBe(true);
        expect(result.slug).toBe("fav-color");

        const expectedDir = path.join(world, "pools", "objects", "agent_a", "knowledge", "memory");
        const content = await fs.readFile(path.join(expectedDir, "fav-color.md"), "utf8");
        expect(content).toBe("My favorite color is octarine.");
    });

    test("normalizes slug to kebab-case", async () => {
        const ctx = makeCtx();
        const result = (await rootServer.public.memory_record!(
            { slug: "My Favorite Color!", content: "octarine" },
            ctx,
        )) as { ok: boolean; slug: string };

        expect(result.ok).toBe(true);
        expect(result.slug).toBe("my-favorite-color");
    });

    test("uses ctx.record.paths.pool when provided", async () => {
        const customPool = path.join(world, "custom-pool");
        const ctx = makeCtx(customPool);
        await rootServer.public.memory_record!(
            { slug: "test-slug", content: "test content" },
            ctx,
        );
        const expectedFile = path.join(customPool, "knowledge", "memory", "test-slug.md");
        const content = await fs.readFile(expectedFile, "utf8");
        expect(content).toBe("test content");
    });

    test("overwrites existing memory with same slug", async () => {
        const ctx = makeCtx();
        await rootServer.public.memory_record!({ slug: "item", content: "v1" }, ctx);
        await rootServer.public.memory_record!({ slug: "item", content: "v2" }, ctx);

        const expectedDir = path.join(world, "pools", "objects", "agent_a", "knowledge", "memory");
        const content = await fs.readFile(path.join(expectedDir, "item.md"), "utf8");
        expect(content).toBe("v2");
    });

    test("throws on missing slug", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.memory_record!({ content: "no slug" }, ctx),
        ).rejects.toThrow("memory_record: args.slug");
    });

    test("throws on empty slug after normalization", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.memory_record!({ slug: "!!!", content: "weird" }, ctx),
        ).rejects.toThrow("memory_record: slug normalizes to empty string");
    });
});
