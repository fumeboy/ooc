import { describe, expect, it } from "bun:test";
import { parseInlineUiSegments } from "./InlineUiContent";

describe("parseInlineUiSegments", () => {
  it("returns single text segment when no token present", () => {
    const r = parseInlineUiSegments("just plain text");
    expect(r).toEqual([{ kind: "text", text: "just plain text" }]);
  });

  it("parses a single ui token", () => {
    const r = parseInlineUiSegments(
      `prefix [[ui{"comp":"file-link","path":"foo.md"}ui]] suffix`,
    );
    expect(r).toEqual([
      { kind: "text", text: "prefix " },
      { kind: "ui", comp: "file-link", props: { path: "foo.md" } },
      { kind: "text", text: " suffix" },
    ]);
  });

  it("parses multiple tokens", () => {
    const r = parseInlineUiSegments(
      `[[ui{"comp":"file-link","path":"a"}ui]] and [[ui{"comp":"file-link","path":"b","label":"B"}ui]]`,
    );
    expect(r).toEqual([
      { kind: "ui", comp: "file-link", props: { path: "a" } },
      { kind: "text", text: " and " },
      { kind: "ui", comp: "file-link", props: { path: "b", label: "B" } },
    ]);
  });

  it("falls back to text when JSON is malformed", () => {
    const r = parseInlineUiSegments(`[[ui{not json}ui]]`);
    expect(r).toEqual([{ kind: "text", text: `[[ui{not json}ui]]` }]);
  });

  it("falls back to text when comp field missing", () => {
    const r = parseInlineUiSegments(`[[ui{"path":"foo"}ui]]`);
    expect(r).toEqual([{ kind: "text", text: `[[ui{"path":"foo"}ui]]` }]);
  });

  it("preserves token text when comp is non-string", () => {
    const r = parseInlineUiSegments(`[[ui{"comp":123,"path":"foo"}ui]]`);
    expect(r).toEqual([{ kind: "text", text: `[[ui{"comp":123,"path":"foo"}ui]]` }]);
  });

  it("matches across multi-line JSON when needed", () => {
    const r = parseInlineUiSegments(
      `look [[ui{\n  "comp":"file-link",\n  "path":"docs/x.md"\n}ui]] here`,
    );
    expect(r).toHaveLength(3);
    expect(r[1]).toEqual({ kind: "ui", comp: "file-link", props: { path: "docs/x.md" } });
  });

  it("handles trailing content after last token", () => {
    const r = parseInlineUiSegments(`[[ui{"comp":"file-link","path":"a"}ui]] tail`);
    expect(r).toEqual([
      { kind: "ui", comp: "file-link", props: { path: "a" } },
      { kind: "text", text: " tail" },
    ]);
  });

  it("handles content with only a token (no surrounding text)", () => {
    const r = parseInlineUiSegments(`[[ui{"comp":"file-link","path":"a"}ui]]`);
    expect(r).toEqual([{ kind: "ui", comp: "file-link", props: { path: "a" } }]);
  });
});
