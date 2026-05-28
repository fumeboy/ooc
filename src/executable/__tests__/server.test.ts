import { describe, expect, test } from "bun:test";
import {
    defineObject,
    MethodNotFoundError,
    MethodNotPublicError,
    type ServerMap,
} from "../server";

describe("server.defineObject", () => {
    test("returns identity SeverMap", () => {
        const map: ServerMap = defineObject({
            public: {
                async foo() { return "foo"; },
            },
            private: {
                async _bar() { return "bar"; },
            },
        });
        expect(typeof map.public.foo).toBe("function");
        expect(typeof map.private._bar).toBe("function");
    });

    test("MethodNotFoundError caries name + uri", () => {
        const e = new MethodNotFoundError("nope", "ooc://stones/main/objects/foo");
        expect(e.methodName).toBe("nope");
        expect(e.objectUri).toBe("ooc://stones/main/objects/foo");
        expect(e.message).toContain("not found");
    });

    test("MethodNotPublicError caries name + uri", () => {
        const e = new MethodNotPublicError("_bar", "ooc://stones/main/objects/foo");
        expect(e.methodName).toBe("_bar");
        expect(e.objectUri).toBe("ooc://stones/main/objects/foo");
        expect(e.message).toContain("private");
    });
});
