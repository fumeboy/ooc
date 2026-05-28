import { describe, expect, test } from "bun:test";
import type { ObjectRecord } from "../../persistable/object-record";
import { ObjectRegistry } from "../registry";

describe("ObjectRegistry", () => {
    function makeRecord(uri: string): ObjectRecord {
        return {
            uri,
            paths: { stone: "/tmp/x" },
            kind: "persistent",
            self: {},
        };
    }

    test("set / get / has roundtrip", () => {
        const r = new ObjectRegistry();
        const rec = makeRecord("ooc://stones/main/objects/foo");
        r.set(rec);
        expect(r.has(rec.uri)).toBe(true);
        expect(r.get(rec.uri)).toBe(rec);
    });

    test("get unknown returns undefined", () => {
        const r = new ObjectRegistry();
        expect(r.get("ooc://stones/main/objects/missing")).toBeUndefined();
    });

    test("set overwrites existing", () => {
        const r = new ObjectRegistry();
        const r1 = makeRecord("ooc://stones/main/objects/foo");
        const r2: ObjectRecord = { ...r1, self: { extends: "search" } };
        r.set(r1);
        r.set(r2);
        expect(r.get(r1.uri)).toBe(r2);
        expect(r.size).toBe(1);
    });

    test("delete + clear", () => {
        const r = new ObjectRegistry();
        r.set(makeRecord("ooc://stones/main/objects/a"));
        r.set(makeRecord("ooc://stones/main/objects/b"));
        expect(r.delete("ooc://stones/main/objects/a")).toBe(true);
        expect(r.size).toBe(1);
        r.clear();
        expect(r.size).toBe(0);
    });

    test("list returns all records", () => {
        const r = new ObjectRegistry();
        r.set(makeRecord("ooc://stones/main/objects/a"));
        r.set(makeRecord("ooc://stones/main/objects/b"));
        const all = r.list();
        expect(all).toHaveLength(2);
        expect(all.map((x) => x.uri).sort()).toEqual([
            "ooc://stones/main/objects/a",
            "ooc://stones/main/objects/b",
        ]);
    });
});
