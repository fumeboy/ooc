import { describe, expect, test } from "bun:test";
import {
    type ObjectRecord,
    isBuiltin,
    isEphemeral,
    isPersistent,
} from "../object-record";

describe("ObjectRecord helpers", () => {
    test("isBuiltin returns true only for builtin kind", () => {
        const builtin: ObjectRecord = {
            uri: "ooc://stones/_builtin/objects/root",
            paths: { stone: "/tmp/stones/_builtin/objects/root" },
            kind: "builtin",
            self: {},
        };
        const persistent: ObjectRecord = {
            uri: "ooc://stones/main/objects/foo",
            paths: { stone: "/tmp/stones/main/objects/foo", pool: "/tmp/pools/objects/foo" },
            kind: "persistent",
            self: { extends: "root" },
        };
        expect(isBuiltin(builtin)).toBe(true);
        expect(isBuiltin(persistent)).toBe(false);
    });

    test("isPersistent + isEphemeral mutually exclusive with builtin", () => {
        const ephemeral: ObjectRecord = {
            uri: "ooc://flows/s_abc/objects/search_x1",
            paths: { flow: "/tmp/flows/s_abc/objects/search_x1" },
            kind: "ephemeral",
            self: { extends: "search" },
        };
        expect(isPersistent(ephemeral)).toBe(false);
        expect(isEphemeral(ephemeral)).toBe(true);
        expect(isBuiltin(ephemeral)).toBe(false);
    });
});
