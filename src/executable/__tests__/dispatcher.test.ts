import { describe, expect, test } from "bun:test";
import type { ObjectRecord } from "@src/persistable/object-record";
import { ObjectRegistry } from "../registry";
import {
    invokeMethod,
    invokePrivateMethod,
    listPublicMethods,
} from "../dispatcher";
import { MethodNotFoundError, MethodNotPublicError } from "../server";

function makeRegistry(): ObjectRegistry {
    const reg = new ObjectRegistry();

    // root prototype with talk/help
    const rootRec: ObjectRecord = {
        uri: "ooc://stones/_builtin/objects/root",
        paths: { stone: "/builtin/root" },
        kind: "builtin",
        self: {},
        serverPublic: {
            async talk(args: any) {
                return { ok: true, said: args.content };
            },
            async help() {
                return "root help";
            },
        },
        serverPrivate: {
            async _internal() {
                return "internal";
            },
        },
    };
    reg.set(rootRec);

    // a child object that extends root but overrides talk + adds own method
    const childRec: ObjectRecord = {
        uri: "ooc://stones/main/objects/agent_a",
        paths: { stone: "/main/agent_a" },
        kind: "persistent",
        self: { extends: "root" },
        serverPublic: {
            async talk(args: any) {
                return { ok: true, said: "child:" + args.content };
            },
            async bespoke() {
                return "I am agent_a";
            },
        },
    };
    reg.set(childRec);

    return reg;
}

const baseCtx = {
    worldRoot: "/tmp/world",
    sessionId: "s_test",
    registry: undefined as any,  // 由测试在调用前 set
};

describe("dispatcher.invokeMethod", () => {
    test("调自身 override → 自身 body 跑", async () => {
        const reg = makeRegistry();
        const ctx = { ...baseCtx, registry: reg };
        const result = (await invokeMethod(
            reg,
            "ooc://stones/main/objects/agent_a",
            "talk",
            { content: "hi" },
            ctx,
        )) as any;
        expect(result.said).toBe("child:hi");
    });

    test("调祖先 method (help) → 沿链到 root", async () => {
        const reg = makeRegistry();
        const ctx = { ...baseCtx, registry: reg };
        const result = await invokeMethod(
            reg,
            "ooc://stones/main/objects/agent_a",
            "help",
            {},
            ctx,
        );
        expect(result).toBe("root help");
    });

    test("调自身独有 method", async () => {
        const reg = makeRegistry();
        const ctx = { ...baseCtx, registry: reg };
        const result = await invokeMethod(
            reg,
            "ooc://stones/main/objects/agent_a",
            "bespoke",
            {},
            ctx,
        );
        expect(result).toBe("I am agent_a");
    });

    test("MethodNotFoundError 当方法链上都没有", async () => {
        const reg = makeRegistry();
        const ctx = { ...baseCtx, registry: reg };
        await expect(
            invokeMethod(reg, "ooc://stones/main/objects/agent_a", "missing", {}, ctx),
        ).rejects.toThrow(MethodNotFoundError);
    });

    test("MethodNotPublicError 当方法只在 private 上存在", async () => {
        const reg = makeRegistry();
        const ctx = { ...baseCtx, registry: reg };
        await expect(
            invokeMethod(
                reg,
                "ooc://stones/main/objects/agent_a",
                "_internal",
                {},
                ctx,
            ),
        ).rejects.toThrow(MethodNotPublicError);
    });

    test("Object not registered → 抛错", async () => {
        const reg = makeRegistry();
        const ctx = { ...baseCtx, registry: reg };
        await expect(
            invokeMethod(reg, "ooc://stones/main/objects/missing", "talk", {}, ctx),
        ).rejects.toThrow(/not registered/);
    });

    test("ctx.record 是 target 不是 prototype owner", async () => {
        const reg = makeRegistry();
        // 加一个 method 用于探测 ctx.record
        reg.get("ooc://stones/_builtin/objects/root")!.serverPublic!.whoami =
            async (_args: any, ctx2: any) => ctx2.record.uri;
        const ctx = { ...baseCtx, registry: reg };
        const result = await invokeMethod(
            reg,
            "ooc://stones/main/objects/agent_a",
            "whoami",
            {},
            ctx,
        );
        expect(result).toBe("ooc://stones/main/objects/agent_a");
    });
});

describe("dispatcher.invokePrivateMethod", () => {
    test("调自身 private method", async () => {
        const reg = makeRegistry();
        const ctx = { ...baseCtx, registry: reg };
        const result = await invokePrivateMethod(
            reg,
            "ooc://stones/_builtin/objects/root",
            "_internal",
            {},
            ctx,
        );
        expect(result).toBe("internal");
    });

    test("private 不沿链查 → 子类调祖先 private 抛错", async () => {
        const reg = makeRegistry();
        const ctx = { ...baseCtx, registry: reg };
        await expect(
            invokePrivateMethod(
                reg,
                "ooc://stones/main/objects/agent_a",
                "_internal",
                {},
                ctx,
            ),
        ).rejects.toThrow(MethodNotFoundError);
    });
});

describe("dispatcher.listPublicMethods", () => {
    test("合并自身 + 链上所有 public method，子类先于祖先", () => {
        const reg = makeRegistry();
        const names = listPublicMethods(reg, "ooc://stones/main/objects/agent_a");
        // 期望: talk (child覆盖 → 子类先), bespoke (子类独有), help (祖先唯一)
        expect(names).toEqual(["talk", "bespoke", "help"]);
    });

    test("root 自身只暴露 root 的 public", () => {
        const reg = makeRegistry();
        const names = listPublicMethods(reg, "ooc://stones/_builtin/objects/root");
        expect(names.sort()).toEqual(["help", "talk"]);
    });
});
