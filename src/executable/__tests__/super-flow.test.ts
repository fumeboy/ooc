import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { promoteEphemeral } from "../super-flow";

describe("super-flow.promoteEphemeral", () => {
    let world: string;

    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-super-flow-"));
    });

    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    async function writeFile(rel: string, body: string) {
        const abs = path.join(world, rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, body, "utf8");
    }

    async function readFile(rel: string): Promise<string> {
        return fs.readFile(path.join(world, rel), "utf8");
    }

    test("基本升格：self.md 写入 stones/", async () => {
        await writeFile(
            "flows/s1/objects/search_abc/self.md",
            "---\nextends: search\nquery: typescript\n---\n# Search Result\n",
        );

        const result = await promoteEphemeral({
            worldRoot: world,
            sourceUri: "ooc://flows/s1/objects/search_abc",
            targetBranch: "main",
            targetName: "my_search",
        });

        expect(result.persistentUri).toBe("ooc://stones/main/objects/my_search");
        const stoneContent = await readFile("stones/main/objects/my_search/self.md");
        expect(stoneContent).toContain("extends: search");
        expect(stoneContent).toContain("typescript");
        expect(result.copiedDesignFiles).toContain("self.md");
    });

    test("readme.md 也被复制", async () => {
        await writeFile("flows/s1/objects/agent_x/self.md", "---\nextends: root\n---\n");
        await writeFile("flows/s1/objects/agent_x/readme.md", "# My Agent\n");

        const result = await promoteEphemeral({
            worldRoot: world,
            sourceUri: "ooc://flows/s1/objects/agent_x",
            targetBranch: "main",
            targetName: "agent_x_persistent",
        });

        const readme = await readFile("stones/main/objects/agent_x_persistent/readme.md");
        expect(readme).toContain("My Agent");
        expect(result.copiedDesignFiles).toContain("readme.md");
    });

    test("运行时文件（talks/ threads/ todos.json）不被复制", async () => {
        await writeFile("flows/s1/objects/ep/self.md", "---\nextends: root\n---\n");
        await writeFile("flows/s1/objects/ep/todos.json", "[]");
        await writeFile("flows/s1/objects/ep/talks/peer.jsonl", '{"content":"hi"}');

        await promoteEphemeral({
            worldRoot: world,
            sourceUri: "ooc://flows/s1/objects/ep",
            targetBranch: "main",
            targetName: "ep_promoted",
        });

        const stonePath = path.join(world, "stones/main/objects/ep_promoted");
        expect(existsSync(path.join(stonePath, "todos.json"))).toBe(false);
        expect(existsSync(path.join(stonePath, "talks"))).toBe(false);
        expect(existsSync(path.join(stonePath, "threads"))).toBe(false);
    });

    test("源 flows/ 目录在升格后保持不变（考古链）", async () => {
        const selfContent = "---\nextends: root\n---\n# Keep Me\n";
        await writeFile("flows/s1/objects/ep2/self.md", selfContent);
        await writeFile("flows/s1/objects/ep2/todos.json", "[]");

        await promoteEphemeral({
            worldRoot: world,
            sourceUri: "ooc://flows/s1/objects/ep2",
            targetBranch: "main",
            targetName: "ep2_promoted",
        });

        // 原文件依然存在
        const original = await readFile("flows/s1/objects/ep2/self.md");
        expect(original).toBe(selfContent);
        // 运行时文件也保留
        expect(existsSync(path.join(world, "flows/s1/objects/ep2/todos.json"))).toBe(true);
    });

    test("pool.json 存在时复制到 pools/", async () => {
        await writeFile("flows/s2/objects/rich_ep/self.md", "---\nextends: root\n---\n");
        await writeFile("flows/s2/objects/rich_ep/pool.json", '{"count":42}');

        const result = await promoteEphemeral({
            worldRoot: world,
            sourceUri: "ooc://flows/s2/objects/rich_ep",
            targetBranch: "main",
            targetName: "rich_persistent",
        });

        expect(result.poolCopied).toBe(true);
        expect(result.poolPath).toBeDefined();
        const poolContent = await readFile("pools/objects/rich_persistent/pool.json");
        expect(poolContent).toContain("42");
    });

    test("copyPool=false → 不复制 pool.json", async () => {
        await writeFile("flows/s3/objects/ep3/self.md", "---\nextends: root\n---\n");
        await writeFile("flows/s3/objects/ep3/pool.json", '{"data":"skip me"}');

        const result = await promoteEphemeral({
            worldRoot: world,
            sourceUri: "ooc://flows/s3/objects/ep3",
            targetBranch: "main",
            targetName: "ep3_promoted",
            copyPool: false,
        });

        expect(result.poolCopied).toBe(false);
        expect(
            existsSync(path.join(world, "pools/objects/ep3_promoted/pool.json")),
        ).toBe(false);
    });

    test("pool.json 不存在时 poolCopied=false（安静跳过）", async () => {
        await writeFile("flows/s4/objects/no_pool/self.md", "---\nextends: root\n---\n");

        const result = await promoteEphemeral({
            worldRoot: world,
            sourceUri: "ooc://flows/s4/objects/no_pool",
            targetBranch: "main",
            targetName: "no_pool_promoted",
        });

        expect(result.poolCopied).toBe(false);
        expect(result.poolPath).toBeUndefined();
    });

    test("sourceUri 格式错误时抛错", async () => {
        expect(
            promoteEphemeral({
                worldRoot: world,
                sourceUri: "ooc://stones/main/objects/not_ephemeral",
                targetBranch: "main",
                targetName: "x",
            }),
        ).rejects.toThrow(/ooc:\/\/flows\//);
    });

    test("源目录不存在时抛错", async () => {
        expect(
            promoteEphemeral({
                worldRoot: world,
                sourceUri: "ooc://flows/s5/objects/nonexistent",
                targetBranch: "main",
                targetName: "x",
            }),
        ).rejects.toThrow(/不存在/);
    });
});
