import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadObjects } from "../loader";

describe("loader: 三层源扫描", () => {
    let world: string;

    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-loader-test-"));
    });

    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    async function write(p: string, body: string) {
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, body);
    }

    test("空 world 返回空列表", async () => {
        const records = await loadObjects({ worldRoot: world });
        expect(records).toEqual([]);
    });

    test("builtin 扫描", async () => {
        await write(
            path.join(world, "stones", "_builtin", "objects", "root", "self.md"),
            "---\n# root prototype\n---\n# root\n",
        );
        await write(
            path.join(world, "stones", "_builtin", "objects", "search", "self.md"),
            "---\nextends: root\n---\n# search\n",
        );

        const records = await loadObjects({ worldRoot: world });
        expect(records).toHaveLength(2);
        const root = records.find((r) => r.uri.endsWith("/root"));
        const search = records.find((r) => r.uri.endsWith("/search"));
        expect(root).toBeDefined();
        expect(search).toBeDefined();
        expect(root!.kind).toBe("builtin");
        expect(search!.self.extends).toBe("root");
    });

    test("branch persistent 含 children 递归", async () => {
        await write(
            path.join(world, "stones", "main", "objects", "foo", "self.md"),
            "---\nextends: root\n---\n# foo\n",
        );
        await write(
            path.join(world, "stones", "main", "objects", "foo", "children", "bar", "self.md"),
            "---\n---\n# bar child\n",
        );

        const records = await loadObjects({ worldRoot: world, branch: "main" });
        expect(records).toHaveLength(2);
        const foo = records.find((r) => r.uri === "ooc://stones/main/objects/foo");
        const bar = records.find((r) =>
            r.uri === "ooc://stones/main/objects/foo/children/bar",
        );
        expect(foo).toBeDefined();
        expect(bar).toBeDefined();
        expect(foo!.kind).toBe("persistent");
        expect(foo!.paths.pool).toBe(path.join(world, "pools", "objects", "foo"));
        expect(bar!.paths.pool).toBe(
            path.join(world, "pools", "objects", "foo", "children", "bar"),
        );
    });

    test("flow ephemeral 扫描", async () => {
        await write(
            path.join(world, "flows", "s_abc", "objects", "search_x1", "self.md"),
            "---\nextends: search\nquery: foo\n---\n# search result\n",
        );

        const records = await loadObjects({ worldRoot: world, sessionId: "s_abc" });
        expect(records).toHaveLength(1);
        const r = records[0];
        expect(r.uri).toBe("ooc://flows/s_abc/objects/search_x1");
        expect(r.kind).toBe("ephemeral");
        expect(r.self.extends).toBe("search");
        expect(r.self.query).toBe("foo");
        expect(r.paths.flow).toBeDefined();
        expect(r.paths.stone).toBeUndefined();
    });

    test("三层组合", async () => {
        await write(
            path.join(world, "stones", "_builtin", "objects", "root", "self.md"),
            "---\n---\n",
        );
        await write(
            path.join(world, "stones", "main", "objects", "foo", "self.md"),
            "---\nextends: root\n---\n",
        );
        await write(
            path.join(world, "flows", "s_abc", "objects", "search_x1", "self.md"),
            "---\nextends: search\n---\n",
        );

        const records = await loadObjects({
            worldRoot: world,
            branch: "main",
            sessionId: "s_abc",
        });

        expect(records).toHaveLength(3);
        expect(records.filter((r) => r.kind === "builtin")).toHaveLength(1);
        expect(records.filter((r) => r.kind === "persistent")).toHaveLength(1);
        expect(records.filter((r) => r.kind === "ephemeral")).toHaveLength(1);
    });

    test("self.md 无 frontmatter 返回空 self", async () => {
        await write(
            path.join(world, "stones", "_builtin", "objects", "foo", "self.md"),
            "# 无 frontmatter\n",
        );
        const records = await loadObjects({ worldRoot: world });
        expect(records).toHaveLength(1);
        expect(records[0].self).toEqual({});
    });
});
