import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import rootServer from "../server/index";
import { ObjectRegistry } from "@src/executable/registry";
import type { ObjectRecord } from "@src/persistable/object-record";
import type { ObjectContext } from "@src/executable/server";

describe("root.exec_command", () => {
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
        world = await fs.mkdtemp(path.join(os.tmpdir(), "ooc-exec-test-"));
    });
    afterEach(async () => {
        await fs.rm(world, { recursive: true, force: true });
    });

    test("exec_command echo returns stdout + exit 0", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.exec_command!({ command: ["echo", "hello"] } as any, ctx)) as any;
        expect(r.ok).toBe(true);
        expect(r.exit_code).toBe(0);
        expect(r.stdout).toContain("hello");
    });

    test("exec_command failed command returns non-zero exit", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.exec_command!({ command: ["false"] } as any, ctx)) as any;
        expect(r.ok).toBe(false);
        expect(r.exit_code).not.toBe(0);
    });

    test("exec_command rejects cwd outside worldRoot", async () => {
        const ctx = makeCtx();
        await expect(
            rootServer.public.exec_command!({ command: ["ls"], cwd: "/etc" } as any, ctx),
        ).rejects.toThrow(/outside worldRoot/);
    });

    test("exec_command captures stderr", async () => {
        const ctx = makeCtx();
        const r = (await rootServer.public.exec_command!(
            { command: ["sh", "-c", "echo err >&2; exit 1"] } as any,
            ctx,
        )) as any;
        expect(r.stderr).toContain("err");
        expect(r.exit_code).toBe(1);
    });
});
