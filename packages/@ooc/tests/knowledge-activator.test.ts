/**
 * knowledge activator smoke test —— 验证 trigger 解析 + 求值 + computeActivations。
 *
 * **issue N**: 整套机制从 `@ooc/core/thinkable/knowledge` 迁入 `@ooc/builtins/knowledge_base/activator`,
 * Trigger 协议简化为单一 intent 维度（退役 window:: / method:: / super::），import 路径与测试 case
 * 一并更新。
 */
import { describe, it, expect } from "bun:test";
import {
  parseTrigger,
  evaluateTrigger,
  maxLevel,
  parseActivatesOn,
  computeActivations,
  type ActivationContext,
  type KnowledgeIndex,
  type KnowledgeDoc,
} from "@ooc/builtins/knowledge_base/activator";

describe("activator.expr (intent-only)", () => {
  it("parseTrigger intent::class::<class>", () => {
    expect(parseTrigger("intent::class::root")).toEqual({
      kind: "intent",
      name: "class::root",
    });
  });

  it("parseTrigger intent::form_open::<class>::<guide>", () => {
    expect(parseTrigger("intent::form_open::file::open")).toEqual({
      kind: "intent",
      name: "form_open::file::open",
    });
  });

  it("parseTrigger intent::super_flow::active", () => {
    expect(parseTrigger("intent::super_flow::active")).toEqual({
      kind: "intent",
      name: "super_flow::active",
    });
  });

  it("parseTrigger throws on legacy 'window::' / 'method::' / 'super' (retired)", () => {
    expect(() => parseTrigger("window::foo")).toThrow(/unknown trigger/);
    expect(() => parseTrigger("method::file::open")).toThrow(/unknown trigger/);
    expect(() => parseTrigger("super")).toThrow(/unknown trigger/);
  });

  it("parseTrigger throws on unknown", () => {
    expect(() => parseTrigger("unknown::xyz")).toThrow(/unknown trigger/);
  });

  it("evaluateTrigger intent matches env.intents", () => {
    const env: ActivationContext = {
      intents: new Set(["class::root", "form_open::file::open"]),
    };
    expect(evaluateTrigger({ kind: "intent", name: "class::root" }, env)).toBe(true);
    expect(evaluateTrigger({ kind: "intent", name: "class::other" }, env)).toBe(false);
    expect(evaluateTrigger({ kind: "intent", name: "form_open::file::open" }, env)).toBe(true);
  });

  it("maxLevel: show_content > show_description", () => {
    expect(maxLevel(undefined, "show_description")).toBe("show_description");
    expect(maxLevel("show_description", "show_content")).toBe("show_content");
    expect(maxLevel("show_content", "show_description")).toBe("show_content");
  });

  it("parseActivatesOn parses valid + skips invalid", () => {
    const out = parseActivatesOn({
      "intent::class::foo": "show_content",
      "garbage::xxx": "show_description",
      "intent::super_flow::active": "show_description",
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
        frontmatter: { activates_on: { "intent::class::foo": "show_content" } },
        body: "body of a",
        mtime: 0,
      },
      {
        path: "b",
        file: "b.md",
        frontmatter: { activates_on: { "intent::super_flow::active": "show_description" } },
        body: "body of b",
        mtime: 0,
      },
      {
        path: "c",
        file: "c.md",
        frontmatter: { activates_on: { "intent::class::nonexistent": "show_content" } },
        body: "body of c",
        mtime: 0,
      },
    ];
    const index: KnowledgeIndex = { byPath: new Map(docs.map((d) => [d.path, d])) };
    const env: ActivationContext = {
      intents: new Set(["class::foo", "super_flow::active"]),
    };
    const results = computeActivations(index, env);
    expect(results.length).toBe(2);
    expect(results.find((r) => r.path === "a")?.presentation).toBe("full");
    expect(results.find((r) => r.path === "b")?.presentation).toBe("summary");
    expect(results.find((r) => r.path === "c")).toBeUndefined();
  });
});
