import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    appendTalkEntry,
    ensureFlowDir,
    ensureTalksDir,
    flowObjectDir,
    nameFromUri,
    peerSlugFromUri,
    peerUriFromSlug,
    planFile,
    shortId,
    talksFile,
    threadDir,
    todosFile,
} from "../flow-paths";

describe("flow-paths", () => {
    let world: string;
    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-flow-paths-"));
    });
    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    test("flowObjectDir 拼对", () => {
        expect(flowObjectDir("/w", "s_abc", "agent_a")).toBe(
            path.join("/w", "flows", "s_abc", "objects", "agent_a"),
        );
    });

    test("nameFromUri 处理顶层 / child / ephemeral", () => {
        expect(nameFromUri("ooc://stones/main/objects/foo")).toBe("foo");
        expect(nameFromUri("ooc://stones/main/objects/foo/children/bar")).toBe("bar");
        expect(nameFromUri("ooc://flows/s/objects/search_xy")).toBe("search_xy");
    });

    test("peerSlug 可逆", () => {
        const uri = "ooc://stones/main/objects/agent_b";
        const slug = peerSlugFromUri(uri);
        expect(peerUriFromSlug(slug)).toBe(uri);
        // 不含 "/" (URL-safe)
        expect(slug.includes("/")).toBe(false);
    });

    test("ensureFlowDir 创建目录", async () => {
        const dir = await ensureFlowDir(world, "s1", "obj1");
        const stat = await fs.stat(dir);
        expect(stat.isDirectory()).toBe(true);
    });

    test("ensureTalksDir 创建 talks 子目录", async () => {
        const dir = await ensureTalksDir(world, "s1", "obj1");
        expect(dir).toBe(path.join(world, "flows", "s1", "objects", "obj1", "talks"));
        const stat = await fs.stat(dir);
        expect(stat.isDirectory()).toBe(true);
    });

    test("appendTalkEntry append 一行到正确文件", async () => {
        await appendTalkEntry(world, "s1", "agent_a", {
            ts: "2026-05-28T00:00:00Z",
            direction: "out",
            peer: "ooc://stones/main/objects/agent_b",
            content: "hello",
        });
        const f = talksFile(world, "s1", "agent_a", "ooc://stones/main/objects/agent_b");
        const body = await fs.readFile(f, "utf8");
        const lines = body.trim().split("\n");
        expect(lines).toHaveLength(1);
        const parsed = JSON.parse(lines[0]);
        expect(parsed.direction).toBe("out");
        expect(parsed.content).toBe("hello");
    });

    test("appendTalkEntry 累积 append", async () => {
        for (let i = 0; i < 3; i++) {
            await appendTalkEntry(world, "s1", "agent_a", {
                ts: "2026-05-28T00:00:0" + i + "Z",
                direction: i % 2 === 0 ? "out" : "in",
                peer: "ooc://stones/main/objects/agent_b",
                content: "msg " + i,
            });
        }
        const f = talksFile(world, "s1", "agent_a", "ooc://stones/main/objects/agent_b");
        const lines = (await fs.readFile(f, "utf8")).trim().split("\n");
        expect(lines).toHaveLength(3);
    });

    test("threadDir 路径正确", () => {
        const d = threadDir("/w", "s1", "obj1", "t_xy");
        expect(d).toBe(path.join("/w", "flows", "s1", "objects", "obj1", "threads", "t_xy"));
    });

    test("todosFile / planFile 路径正确", () => {
        expect(todosFile("/w", "s1", "obj1")).toBe(
            path.join("/w", "flows", "s1", "objects", "obj1", "todos.json"),
        );
        expect(planFile("/w", "s1", "obj1")).toBe(
            path.join("/w", "flows", "s1", "objects", "obj1", "plan.md"),
        );
    });

    test("shortId 8 字符 hex", () => {
        const id = shortId();
        expect(id).toMatch(/^[0-9a-f]{8}$/);
    });

    test("shortId with prefix", () => {
        const id = shortId("t");
        expect(id).toMatch(/^t_[0-9a-f]{8}$/);
    });
});
