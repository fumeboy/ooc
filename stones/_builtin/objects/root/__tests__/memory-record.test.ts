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

    test("writes .md file to synthesized pool memory dir with YAML frontmatter", async () => {
        const ctx = makeCtx();
        const result = (await rootServer.public.memory_record!(
            { slug: "fav-color", content: "My favorite color is octarine." },
            ctx,
        )) as { ok: boolean; slug: string; path: string };

        expect(result.ok).toBe(true);
        expect(result.slug).toBe("fav-color");

        const expectedDir = path.join(world, "pools", "objects", "agent_a", "knowledge", "memory");
        const raw = await fs.readFile(path.join(expectedDir, "fav-color.md"), "utf8");
        // File must start with YAML frontmatter
        expect(raw.startsWith("---")).toBe(true);
        expect(raw).toContain("created_at:");
        expect(raw).toContain("session_id:");
        expect(raw).toContain("object_uri:");
        // Content appears after frontmatter
        expect(raw).toContain("My favorite color is octarine.");
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
        const raw = await fs.readFile(expectedFile, "utf8");
        expect(raw).toContain("test content");
        expect(raw.startsWith("---")).toBe(true);
    });

    test("overwrites existing memory with same slug", async () => {
        const ctx = makeCtx();
        await rootServer.public.memory_record!({ slug: "item", content: "v1" }, ctx);
        await rootServer.public.memory_record!({ slug: "item", content: "v2" }, ctx);

        const expectedDir = path.join(world, "pools", "objects", "agent_a", "knowledge", "memory");
        const raw = await fs.readFile(path.join(expectedDir, "item.md"), "utf8");
        // Content is v2 (overwritten)
        expect(raw).toContain("v2");
        expect(raw).not.toContain("v1");
    });

    test("frontmatter is stripped when loadPoolMemory returns content to LLM", async () => {
        const ctx = makeCtx();
        await rootServer.public.memory_record!(
            { slug: "strip-test", content: "The actual content." },
            ctx,
        );
        // Use defaultContext to see what the LLM receives
        const { defaultContext } = await import("../server/index");
        const slices = await defaultContext({ ...ctx, record: { ...ctx.record, paths: { ...ctx.record.paths, flow: path.join(world, "flows", sessionId, "objects", "agent_a") } } });
        const pm = slices.find((s) => s.kind === "pool_memory");
        expect(pm).toBeDefined();
        const items = pm!.payload as Array<{ slug: string; content: string }>;
        const item = items.find((i) => i.slug === "strip-test");
        expect(item).toBeDefined();
        // LLM-facing content must not contain frontmatter delimiters
        expect(item!.content).not.toContain("---");
        expect(item!.content).not.toContain("created_at:");
        expect(item!.content).toContain("The actual content.");
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
