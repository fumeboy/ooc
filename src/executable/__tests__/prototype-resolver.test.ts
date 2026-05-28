import { describe, expect, test } from "bun:test";
import type { ObjectRecord } from "../../persistable/object-record";
import { ObjectRegistry } from "../registry";
import { findInChain, resolveChain } from "../prototype-resolver";

function buildRegistry(records: ObjectRecord[]): ObjectRegistry {
    const r = new ObjectRegistry();
    records.forEach((rec) => r.set(rec));
    return r;
}

function rec(uri: string, extendsValue?: string): ObjectRecord {
    return {
        uri,
        paths: { stone: "/tmp" },
        kind: "builtin",
        self: extendsValue ? { extends: extendsValue } : {},
    };
}

describe("prototype-resolver.resolveChain", () => {
    test("root 自身 (无 extends) → 链只含自己", () => {
        const reg = buildRegistry([rec("ooc://stones/_builtin/objects/root")]);
        const chain = resolveChain(reg, "ooc://stones/_builtin/objects/root");
        expect(chain).toEqual(["ooc://stones/_builtin/objects/root"]);
    });

    test("一层 extends: search → root", () => {
        const reg = buildRegistry([
            rec("ooc://stones/_builtin/objects/root"),
            rec("ooc://stones/_builtin/objects/search", "root"),
        ]);
        const chain = resolveChain(reg, "ooc://stones/_builtin/objects/search");
        expect(chain).toEqual([
            "ooc://stones/_builtin/objects/search",
            "ooc://stones/_builtin/objects/root",
        ]);
    });

    test("三层链 foo → bar → root", () => {
        const reg = buildRegistry([
            rec("ooc://stones/_builtin/objects/root"),
            rec("ooc://stones/_builtin/objects/bar", "root"),
            rec("ooc://stones/main/objects/foo", "ooc://stones/_builtin/objects/bar"),
        ]);
        const chain = resolveChain(reg, "ooc://stones/main/objects/foo");
        expect(chain).toEqual([
            "ooc://stones/main/objects/foo",
            "ooc://stones/_builtin/objects/bar",
            "ooc://stones/_builtin/objects/root",
        ]);
    });

    test("循环 a → b → a 抛错", () => {
        const reg = buildRegistry([
            rec("ooc://stones/main/objects/a", "ooc://stones/main/objects/b"),
            rec("ooc://stones/main/objects/b", "ooc://stones/main/objects/a"),
        ]);
        expect(() => resolveChain(reg, "ooc://stones/main/objects/a")).toThrow(
            /Cycle detected/,
        );
    });

    test("链上 missing node 抛错", () => {
        const reg = buildRegistry([
            rec("ooc://stones/main/objects/foo", "ooc://stones/_builtin/objects/missing"),
        ]);
        expect(() => resolveChain(reg, "ooc://stones/main/objects/foo")).toThrow(
            /not found in registry/,
        );
    });
});

describe("prototype-resolver.findInChain", () => {
    test("命中自身", () => {
        const reg = buildRegistry([
            rec("ooc://stones/_builtin/objects/root"),
            rec("ooc://stones/_builtin/objects/search", "root"),
        ]);
        const found = findInChain(reg, "ooc://stones/_builtin/objects/search", (r) =>
            r.uri.endsWith("search"),
        );
        expect(found).toBe("ooc://stones/_builtin/objects/search");
    });

    test("命中祖先", () => {
        const reg = buildRegistry([
            rec("ooc://stones/_builtin/objects/root"),
            rec("ooc://stones/_builtin/objects/search", "root"),
        ]);
        const found = findInChain(reg, "ooc://stones/_builtin/objects/search", (r) =>
            r.uri.endsWith("root"),
        );
        expect(found).toBe("ooc://stones/_builtin/objects/root");
    });

    test("链外无命中返回 undefined", () => {
        const reg = buildRegistry([
            rec("ooc://stones/_builtin/objects/root"),
            rec("ooc://stones/_builtin/objects/search", "root"),
        ]);
        const found = findInChain(reg, "ooc://stones/_builtin/objects/search", () =>
            false,
        );
        expect(found).toBeUndefined();
    });
});
