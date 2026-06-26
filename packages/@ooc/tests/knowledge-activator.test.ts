/**
 * knowledge activator smoke test —— 验证 trigger 解析 + 求值 + computeActivations。
 */
import { describe, it, expect } from "bun:test";
import {
  parseTrigger,
  evaluateTrigger,
  maxLevel,
  parseActivatesOn,
  computeActivations,
  type ActivationContext,
} from "@ooc/core/thinkable/knowledge/index";
import type { KnowledgeIndex, KnowledgeDoc } from "@ooc/core/types/knowledge";

describe("activator.expr", () => {
  it("parseTrigger window::<view>", () => {
    expect(parseTrigger("window::_builtin/agent/todo")).toEqual({
      kind: "window",
      view: "_builtin/agent/todo",
    });
  });

  it("parseTrigger method::<class>::<method>", () => {
    expect(parseTrigger("method::file::open")).toEqual({
      kind: "method",
      class: "file",
      method: "open",
    });
  });

  it("parseTrigger super", () => {
    expect(parseTrigger("super")).toEqual({ kind: "super" });
  });

  it("parseTrigger throws on unknown", () => {
    expect(() => parseTrigger("unknown::xyz")).toThrow(/unknown trigger/);
  });

  it("evaluateTrigger window matches windowViews", () => {
    const env: ActivationContext = {
      windowViews: new Set(["foo"]),
      methodForms: new Set(),
      activeIntents: new Set(),
      inSuper: false,
    };
    expect(evaluateTrigger({ kind: "window", view: "foo" }, env)).toBe(true);
    expect(evaluateTrigger({ kind: "window", view: "bar" }, env)).toBe(false);
  });

  it("evaluateTrigger super matches inSuper", () => {
    const a: ActivationContext = {
      windowViews: new Set(),
      methodForms: new Set(),
      activeIntents: new Set(),
      inSuper: true,
    };
    expect(evaluateTrigger({ kind: "super" }, a)).toBe(true);
    const b = { ...a, inSuper: false };
    expect(evaluateTrigger({ kind: "super" }, b)).toBe(false);
  });

  it("parseTrigger intent::<name>", () => {
    expect(parseTrigger("intent::create_file")).toEqual({ kind: "intent", name: "create_file" });
  });

  it("evaluateTrigger intent matches activeIntents", () => {
    const env: ActivationContext = {
      windowViews: new Set(),
      methodForms: new Set(),
      activeIntents: new Set(["create_file"]),
      inSuper: false,
    };
    expect(evaluateTrigger({ kind: "intent", name: "create_file" }, env)).toBe(true);
    expect(evaluateTrigger({ kind: "intent", name: "delete" }, env)).toBe(false);
  });

  it("maxLevel: show_content > show_description", () => {
    expect(maxLevel(undefined, "show_description")).toBe("show_description");
    expect(maxLevel("show_description", "show_content")).toBe("show_content");
    expect(maxLevel("show_content", "show_description")).toBe("show_content");
  });

  it("parseActivatesOn parses valid + skips invalid", () => {
    const out = parseActivatesOn({
      "window::foo": "show_content",
      "garbage::xxx": "show_description",
      "super": "show_description",
    });
    expect(out.size).toBe(2);
  });
});

describe("computeActivations", () => {
  it("activates docs matching env, picks max level", () => {
    const docs: KnowledgeDoc[] = [
      {
        path: "a",
        file: "a.md",
        frontmatter: { activates_on: { "window::foo": "show_content" } },
        body: "body of a",
        mtime: 0,
      },
      {
        path: "b",
        file: "b.md",
        frontmatter: { activates_on: { "super": "show_description" } },
        body: "body of b",
        mtime: 0,
      },
      {
        path: "c",
        file: "c.md",
        frontmatter: { activates_on: { "window::nonexistent": "show_content" } },
        body: "body of c",
        mtime: 0,
      },
    ];
    const index: KnowledgeIndex = { byPath: new Map(docs.map((d) => [d.path, d])) };
    const env: ActivationContext = {
      windowViews: new Set(["foo"]),
      methodForms: new Set(),
      activeIntents: new Set(),
      inSuper: true,
    };
    const results = computeActivations(index, env);
    expect(results.length).toBe(2);
    expect(results.find((r) => r.path === "a")?.presentation).toBe("full");
    expect(results.find((r) => r.path === "b")?.presentation).toBe("summary");
    expect(results.find((r) => r.path === "c")).toBeUndefined();
  });
});
