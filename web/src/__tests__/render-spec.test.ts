import { describe, expect, test } from "bun:test";
import { renderObject, type MinimalRecord, type Slice } from "../render-spec";
import { resolveUri, uriToRoutePath } from "../uri-resolver";

// ---------------------------------------------------------------------------
// uri-resolver tests
// ---------------------------------------------------------------------------

describe("uri-resolver.resolveUri", () => {
    test("stones URI → layer=stones, name=foo", () => {
        const r = resolveUri("ooc://stones/main/objects/foo");
        expect(r.layer).toBe("stones");
        expect(r.name).toBe("foo");
        expect(r.sessionId).toBeUndefined();
    });

    test("flows URI → layer=flows, name=bar, sessionId=s1", () => {
        const r = resolveUri("ooc://flows/s1/objects/bar");
        expect(r.layer).toBe("flows");
        expect(r.name).toBe("bar");
        expect(r.sessionId).toBe("s1");
    });

    test("pools URI → layer=pools, name=baz", () => {
        const r = resolveUri("ooc://pools/objects/baz");
        expect(r.layer).toBe("pools");
        expect(r.name).toBe("baz");
    });

    test("builtin URI → layer=stones, name=root", () => {
        const r = resolveUri("ooc://stones/_builtin/objects/root");
        expect(r.layer).toBe("stones");
        expect(r.name).toBe("root");
    });

    test("invalid URI throws", () => {
        expect(() => resolveUri("http://example.com")).toThrow();
    });
});

describe("uri-resolver.uriToRoutePath", () => {
    test("strips ooc:// prefix and adds leading /", () => {
        expect(uriToRoutePath("ooc://stones/main/objects/foo")).toBe(
            "/stones/main/objects/foo",
        );
    });
});

// ---------------------------------------------------------------------------
// render-spec tests
// ---------------------------------------------------------------------------

function sampleRecord(overrides: Partial<MinimalRecord> = {}): MinimalRecord {
    return {
        uri: "ooc://stones/main/objects/my-agent",
        kind: "persistent",
        self: { extends: "root", title: "My Agent" },
        ...overrides,
    };
}

const sampleSlices: Slice[] = [
    { name: "self", label: "Identity", content: { extends: "root" } },
    { name: "pool", label: "Accumulated", content: [] },
];

describe("render-spec.renderObject", () => {
    test("基本结构完整", () => {
        const spec = renderObject(sampleRecord(), sampleSlices);
        expect(spec.uri).toBe("ooc://stones/main/objects/my-agent");
        expect(spec.title).toBe("My Agent");
        expect(spec.header.kind).toBe("persistent");
        expect(spec.header.layer).toBe("stones");
        expect(spec.sections).toHaveLength(2);
        expect(spec.sections[0].name).toBe("self");
    });

    test("talkInput 默认存在", () => {
        const spec = renderObject(sampleRecord(), sampleSlices);
        expect(spec.talkInput).not.toBeNull();
        expect(spec.talkInput!.endpoint).toBe("/api/talk");
        expect(spec.talkInput!.placeholder).toContain("My Agent");
    });

    test("talkable=false → talkInput=null", () => {
        const spec = renderObject(sampleRecord(), sampleSlices, { talkable: false });
        expect(spec.talkInput).toBeNull();
    });

    test("无 title frontmatter → fallback 到 URI 末段", () => {
        const rec = sampleRecord({ self: { extends: "root" } });
        const spec = renderObject(rec, []);
        expect(spec.title).toBe("my-agent");
    });

    test("serverPublic keys → methodButtons", () => {
        const rec = sampleRecord({
            serverPublic: { grep: {}, open_file: {} },
        });
        const spec = renderObject(rec, []);
        expect(spec.methodButtons).toHaveLength(2);
        expect(spec.methodButtons.map((b) => b.name)).toContain("grep");
        expect(spec.methodButtons.map((b) => b.name)).toContain("open_file");
    });

    test("chain 写入 header.extendsChain", () => {
        const chain = [
            "ooc://stones/main/objects/my-agent",
            "ooc://stones/_builtin/objects/root",
        ];
        const spec = renderObject(sampleRecord(), sampleSlices, { chain });
        expect(spec.header.extendsChain).toEqual(chain);
    });

    test("ephemeral flows Object", () => {
        const rec: MinimalRecord = {
            uri: "ooc://flows/s1/objects/search_x1",
            kind: "ephemeral",
            self: { extends: "search" },
        };
        const spec = renderObject(rec, [], { talkable: false });
        expect(spec.header.layer).toBe("flows");
        expect(spec.header.kind).toBe("ephemeral");
        expect(spec.title).toBe("search_x1");
        expect(spec.talkInput).toBeNull();
    });
});
