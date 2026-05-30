// src/executable/prototype/__tests__/self-meta.test.ts
import { describe, expect, test } from "bun:test";
import { parseSelfMeta, normalizeExtends } from "../self-meta";

describe("normalizeExtends", () => {
  test("bare token → builtin proto URI", () => {
    expect(normalizeExtends("search")).toBe("ooc://stones/_builtin/objects/search");
  });
  test("full ooc:// URI → verbatim", () => {
    expect(normalizeExtends("ooc://stones/ooc-4/objects/foo")).toBe("ooc://stones/ooc-4/objects/foo");
  });
});

describe("parseSelfMeta", () => {
  test("no frontmatter → whole text is body, extends defaults to root", () => {
    const r = parseSelfMeta("# I am an agent\nhello");
    expect(r.body).toBe("# I am an agent\nhello");
    expect(r.extends).toBe("ooc://stones/_builtin/objects/root");
  });

  test("frontmatter with bare extends → normalized builtin URI", () => {
    const r = parseSelfMeta("---\nextends: search\n---\nbody here");
    expect(r.extends).toBe("ooc://stones/_builtin/objects/search");
    expect(r.body).toBe("body here");
  });

  test("frontmatter extends: null → chain terminus (null)", () => {
    const r = parseSelfMeta("---\nextends: null\n---\nI am root");
    expect(r.extends).toBeNull();
    expect(r.body).toBe("I am root");
  });

  test("frontmatter present but no extends key → defaults to root", () => {
    const r = parseSelfMeta("---\ntitle: foo\n---\nbody");
    expect(r.extends).toBe("ooc://stones/_builtin/objects/root");
  });

  test("full ooc:// extends in frontmatter → verbatim", () => {
    const r = parseSelfMeta("---\nextends: ooc://stones/main/objects/base\n---\nx");
    expect(r.extends).toBe("ooc://stones/main/objects/base");
  });
});
