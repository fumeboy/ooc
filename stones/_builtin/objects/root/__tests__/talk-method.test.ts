import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import rootServer from "../server/index";
import { ObjectRegistry } from "@src/executable/registry";
import { peerSlugFromUri } from "@src/persistable/flow-paths";
import type { ObjectRecord } from "@src/persistable/object-record";
import type { ObjectContext } from "@src/executable/server";

describe("root.talk", () => {
    let world: string;
    const sessionId = "s_talk_test";

    beforeEach(async () => {
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-talk-test-"));
    });

    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    function makeCtx(selfUri: string): ObjectContext {
        const reg = new ObjectRegistry();
        const rec: ObjectRecord = {
            uri: selfUri,
            paths: { stone: "/tmp" },
            kind: "persistent",
            self: { extends: "root" },
        };
        reg.set(rec);
        return { record: rec, worldRoot: world, sessionId, registry: reg };
    }

    test("talk 写入 self 端 out + target 端 in 两文件", async () => {
        const ctx = makeCtx("ooc://stones/main/objects/agent_a");
        const result = await rootServer.public.talk!(
            { target: "ooc://stones/main/objects/agent_b", content: "hi B" },
            ctx,
        ) as any;
        expect(result.ok).toBe(true);

        // self side: flows/<s>/objects/agent_a/talks/<slug-of-agent_b>.jsonl
        const selfFile = path.join(
            world, "flows", sessionId, "objects", "agent_a", "talks",
            peerSlugFromUri("ooc://stones/main/objects/agent_b") + ".jsonl",
        );
        const selfBody = await fs.readFile(selfFile, "utf8");
        expect(selfBody).toContain('"direction":"out"');
        expect(selfBody).toContain('"content":"hi B"');

        // target side: flows/<s>/objects/agent_b/talks/<slug-of-agent_a>.jsonl
        const targetFile = path.join(
            world, "flows", sessionId, "objects", "agent_b", "talks",
            peerSlugFromUri("ooc://stones/main/objects/agent_a") + ".jsonl",
        );
        const targetBody = await fs.readFile(targetFile, "utf8");
        expect(targetBody).toContain('"direction":"in"');
        expect(targetBody).toContain('"content":"hi B"');
    });

    test("missing target 抛错", async () => {
        const ctx = makeCtx("ooc://stones/main/objects/agent_a");
        await expect(
            rootServer.public.talk!({ content: "no target" } as any, ctx),
        ).rejects.toThrow(/target/);
    });

    test("missing sessionId 抛错", async () => {
        const ctx = makeCtx("ooc://stones/main/objects/agent_a");
        const ctx2: ObjectContext = { ...ctx, sessionId: undefined };
        await expect(
            rootServer.public.talk!(
                { target: "ooc://stones/main/objects/agent_b", content: "x" } as any,
                ctx2,
            ),
        ).rejects.toThrow(/sessionId/);
    });

    test("多次 talk 累积 append", async () => {
        const ctx = makeCtx("ooc://stones/main/objects/agent_a");
        for (let i = 0; i < 3; i++) {
            await rootServer.public.talk!(
                { target: "ooc://stones/main/objects/agent_b", content: "msg " + i } as any,
                ctx,
            );
        }
        const selfFile = path.join(
            world, "flows", sessionId, "objects", "agent_a", "talks",
            peerSlugFromUri("ooc://stones/main/objects/agent_b") + ".jsonl",
        );
        const lines = (await fs.readFile(selfFile, "utf8")).trim().split("\n");
        expect(lines).toHaveLength(3);
    });
});
