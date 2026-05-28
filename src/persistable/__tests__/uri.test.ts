import { describe, expect, test } from "bun:test";
import {
    isOocURI,
    parseURI,
    relativePathToURI,
    resolveExtendsURI,
    uriToRelativePath,
} from "../uri";

describe("ooc:// URI parser", () => {
    test("isOocURI true for ooc:// prefix", () => {
        expect(isOocURI("ooc://stones/main/objects/foo")).toBe(true);
        expect(isOocURI("https://example.com")).toBe(false);
        expect(isOocURI("stones/main/objects/foo")).toBe(false);
    });

    test("parseURI stones path", () => {
        const result = parseURI("ooc://stones/main/objects/foo");
        expect(result.layer).toBe("stones");
        expect(result.head).toBe("main");
        expect(result.rest).toEqual(["objects", "foo"]);
    });

    test("parseURI stones with children", () => {
        const result = parseURI("ooc://stones/main/objects/foo/children/bar");
        expect(result.layer).toBe("stones");
        expect(result.head).toBe("main");
        expect(result.rest).toEqual(["objects", "foo", "children", "bar"]);
    });

    test("parseURI builtin prototype", () => {
        const result = parseURI("ooc://stones/_builtin/objects/root");
        expect(result.layer).toBe("stones");
        expect(result.head).toBe("_builtin");
        expect(result.rest).toEqual(["objects", "root"]);
    });

    test("parseURI flows path", () => {
        const result = parseURI("ooc://flows/s_abc/objects/search_x1");
        expect(result.layer).toBe("flows");
        expect(result.head).toBe("s_abc");
        expect(result.rest).toEqual(["objects", "search_x1"]);
    });

    test("parseURI flows with thread", () => {
        const result = parseURI("ooc://flows/s_abc/objects/foo/threads/t_xy");
        expect(result.layer).toBe("flows");
        expect(result.head).toBe("s_abc");
        expect(result.rest).toEqual(["objects", "foo", "threads", "t_xy"]);
    });

    test("parseURI pools per-Object", () => {
        const result = parseURI("ooc://pools/objects/foo");
        expect(result.layer).toBe("pools");
        expect(result.head).toBe("objects");
        expect(result.rest).toEqual(["foo"]);
    });

    test("parseURI pools shared", () => {
        const result = parseURI("ooc://pools/git-repos/some-repo");
        expect(result.layer).toBe("pools");
        expect(result.head).toBe("git-repos");
        expect(result.rest).toEqual(["some-repo"]);
    });

    test("parseURI rejects non-ooc URI", () => {
        expect(() => parseURI("https://example.com")).toThrow();
    });

    test("parseURI rejects unknown layer", () => {
        expect(() => parseURI("ooc://wat/whatever")).toThrow();
    });

    test("uriToRelativePath strips prefix and joins", () => {
        expect(uriToRelativePath("ooc://stones/main/objects/foo")).toBe(
            "stones/main/objects/foo",
        );
        expect(uriToRelativePath("ooc://flows/s/objects/x")).toBe(
            "flows/s/objects/x",
        );
    });

    test("relativePathToURI inverts uriToRelativePath", () => {
        const uri = "ooc://stones/main/objects/foo/children/bar";
        expect(relativePathToURI(uriToRelativePath(uri))).toBe(uri);
    });

    test("relativePathToURI rejects path outside three layers", () => {
        expect(() => relativePathToURI("src/foo/bar")).toThrow();
    });

    test("resolveExtendsURI expands bare name to builtin URI", () => {
        expect(resolveExtendsURI("search")).toBe(
            "ooc://stones/_builtin/objects/search",
        );
        expect(resolveExtendsURI("root")).toBe(
            "ooc://stones/_builtin/objects/root",
        );
    });

    test("resolveExtendsURI passes through full URI", () => {
        const full = "ooc://stones/main/objects/parent_obj";
        expect(resolveExtendsURI(full)).toBe(full);
    });

    test("resolveExtendsURI rejects shorthand with slash", () => {
        expect(() => resolveExtendsURI("foo/bar")).toThrow();
    });
});
