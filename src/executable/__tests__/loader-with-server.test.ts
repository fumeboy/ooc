import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadObjects } from "../loader";

describe("loader: 动态加载 server module", () => {
    let world: string;

    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-loader-server-"));
    });

    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    async function write(p: string, body: string) {
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, body);
    }

    test("Object 无 server/ 则 serverPublic/Private 为 undefined", async () => {
        await write(
            path.join(world, "stones", "_builtin", "objects", "foo", "self.md"),
            "---\n---\n# foo\n",
        );
        const records = await loadObjects({ worldRoot: world });
        expect(records).toHaveLength(1);
        expect(records[0].serverPublic).toBeUndefined();
        expect(records[0].serverPrivate).toBeUndefined();
    });

    test("Object 有 server/index.ts 则 public/private 都被填充", async () => {
        const objectDir = path.join(world, "stones", "_builtin", "objects", "bar");
        await write(path.join(objectDir, "self.md"), "---\n---\n# bar\n");
        await write(
            path.join(objectDir, "server", "index.ts"),
            `export default {
                public: {
                    async hello() { return "world"; }
                },
                private: {
                    async _internal() { return 42; }
                }
            };`,
        );
        const records = await loadObjects({ worldRoot: world });
        expect(records).toHaveLength(1);
        expect(records[0].serverPublic).toBeDefined();
        expect(typeof records[0].serverPublic!.hello).toBe("function");
        expect(records[0].serverPrivate).toBeDefined();
        expect(typeof records[0].serverPrivate!._internal).toBe("function");
    });

    test("server module 异常时抛错", async () => {
        const objectDir = path.join(world, "stones", "_builtin", "objects", "broken");
        await write(path.join(objectDir, "self.md"), "---\n---\n");
        await write(
            path.join(objectDir, "server", "index.ts"),
            "this is not valid typescript syntax !!!",
        );
        await expect(loadObjects({ worldRoot: world })).rejects.toThrow(
            /Failed to import server module/,
        );
    });
});
