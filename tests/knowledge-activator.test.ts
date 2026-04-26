/**
 * Knowledge Activator 单测：computeKnowledgeRefs 输出
 *
 * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
 */

import { describe, test, expect } from "bun:test";
import { buildPathReverseIndex, lookupTraitsByPaths } from "../src/knowledge/reverse-index.js";
import { computeKnowledgeRefs } from "../src/knowledge/activator.js";
import type { TraitDefinition } from "../src/types/index.js";

function trait(name: string, paths: string[]): TraitDefinition {
  return {
    namespace: "kernel", name, kind: "trait", type: "how_to_think",
    version: "1.0.0", when: "never", description: "",
    readme: `# ${name}`, methods: [], deps: [],
    activatesOn: { paths },
    dir: `/fake/${name}`,
  };
}

describe("buildPathReverseIndex", () => {
  test("indexes traits by their declared paths", () => {
    const traits = [
      trait("talkable", ["talk"]),
      trait("relation_update", ["talk.continue.relation_update"]),
    ];
    const idx = buildPathReverseIndex(traits);
    expect(idx.get("talk")).toEqual(["kernel:talkable"]);
    expect(idx.get("talk.continue.relation_update")).toEqual(["kernel:relation_update"]);
  });

  test("multiple traits on same path are appended", () => {
    const traits = [trait("a", ["talk"]), trait("b", ["talk"])];
    const idx = buildPathReverseIndex(traits);
    expect(idx.get("talk")).toEqual(["kernel:a", "kernel:b"]);
  });

  test("traits without activatesOn are skipped", () => {
    const t = trait("noop", []);
    delete (t as { activatesOn?: unknown }).activatesOn;
    const idx = buildPathReverseIndex([t]);
    expect(idx.size).toBe(0);
  });
});

describe("lookupTraitsByPaths (prefix match)", () => {
  test("declaration 'talk' matches active path 'talk.continue.relation_update'", () => {
    const idx = buildPathReverseIndex([trait("talkable", ["talk"])]);
    const ids = lookupTraitsByPaths(idx, new Set(["talk.continue.relation_update"]));
    expect(ids).toEqual(["kernel:talkable"]);
  });

  test("declaration 'talk.fork' does NOT match 'talk.continue'", () => {
    const idx = buildPathReverseIndex([trait("forky", ["talk.fork"])]);
    const ids = lookupTraitsByPaths(idx, new Set(["talk.continue"]));
    expect(ids).toEqual([]);
  });

  test("dedup: same trait id from multiple paths counted once", () => {
    const t = trait("multi", ["talk", "submit.talk"]);
    const idx = buildPathReverseIndex([t]);
    const ids = lookupTraitsByPaths(idx, new Set(["talk.fork", "submit.talk.compact"]));
    expect(ids).toEqual(["kernel:multi"]);
  });
});

describe("computeKnowledgeRefs from form_match source", () => {
  test("active path emits a KnowledgeRef per matched trait (prefix-aware)", () => {
    const traits = [
      trait("talkable", ["talk"]),
      trait("relation_update", ["talk.continue.relation_update"]),
    ];
    const refs = computeKnowledgeRefs({
      traits,
      activePaths: new Set(["talk.continue.relation_update"]),
    });
    const refIds = refs.map((r) => r.ref).sort();
    expect(refIds).toEqual(["@trait:relation_update", "@trait:talkable"]);
    expect(refs.every((r) => r.source.kind === "form_match")).toBe(true);
    expect(refs.every((r) => r.type === "trait")).toBe(true);
    expect(refs.every((r) => r.presentation === "full")).toBe(true);
    expect(refs.every((r) => typeof r.reason === "string" && r.reason.length > 0)).toBe(true);
  });

  test("empty activePaths emits empty refs", () => {
    const refs = computeKnowledgeRefs({
      traits: [trait("t", ["talk"])],
      activePaths: new Set(),
    });
    expect(refs).toEqual([]);
  });
});
