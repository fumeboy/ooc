/**
 * Knowledge Activator 单测：computeKnowledgeRefs 输出
 *
 * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
 */

import { describe, test, expect } from "bun:test";
import { buildPathReverseIndex, lookupKnowledgeByPaths } from "../src/extendable/knowledge/reverse-index.js";
import { computeKnowledgeRefs } from "../src/extendable/knowledge/activator.js";
import type { TraitDefinition } from "../src/shared/types/index.js";

function trait(name: string, contentPaths: string[], descriptionPaths: string[] = []): TraitDefinition {
  return {
    namespace: "kernel", name, kind: "trait", type: "how_to_think",
    version: "1.0.0", description: "",
    readme: `# ${name}`, deps: [],
    activatesOn: {
      showContentWhen: contentPaths,
      showDescriptionWhen: descriptionPaths,
    },
    dir: `/fake/${name}`,
  };
}

describe("buildPathReverseIndex", () => {
  test("indexes traits by their declared content and description paths", () => {
    const traits = [
      trait("talkable", ["talk"]),
      trait("relation_update", ["talk.continue.relation_update"], ["talk.continue"]),
    ];
    const idx = buildPathReverseIndex(traits);
    expect(idx.get("talk")).toEqual([{ id: "kernel:talkable", presentation: "full" }]);
    expect(idx.get("talk.continue")).toEqual([{ id: "kernel:relation_update", presentation: "summary" }]);
    expect(idx.get("talk.continue.relation_update")).toEqual([{ id: "kernel:relation_update", presentation: "full" }]);
  });

  test("multiple traits on same path are appended", () => {
    const traits = [trait("a", ["talk"]), trait("b", ["talk"])];
    const idx = buildPathReverseIndex(traits);
    expect(idx.get("talk")).toEqual([
      { id: "kernel:a", presentation: "full" },
      { id: "kernel:b", presentation: "full" },
    ]);
  });

  test("traits without activatesOn are skipped", () => {
    const t = trait("noop", []);
    delete (t as { activatesOn?: unknown }).activatesOn;
    const idx = buildPathReverseIndex([t]);
    expect(idx.size).toBe(0);
  });
});

describe("lookupKnowledgeByPaths (exact match)", () => {
  test("declaration 'talk' matches when 'talk' is in activePaths (explicit parent emission)", () => {
    /* In flat table, deriveCommandPaths always includes 'talk' as bare name,
     * so activePaths will contain 'talk' directly — exact match works. */
    const idx = buildPathReverseIndex([trait("talkable", ["talk"])]);
    const hits = lookupKnowledgeByPaths(idx, new Set(["talk", "talk.continue", "talk.relation_update", "talk.continue.relation_update"]));
    expect(hits).toEqual([{ id: "kernel:talkable", presentation: "full", matchedPath: "talk" }]);
  });

  test("declaration 'talk' does NOT match when only 'talk.continue.relation_update' in activePaths（exact, no prefix）", () => {
    const idx = buildPathReverseIndex([trait("talkable", ["talk"])]);
    const hits = lookupKnowledgeByPaths(idx, new Set(["talk.continue.relation_update"]));
    expect(hits).toEqual([]);
  });

  test("declaration 'talk.fork' does NOT match 'talk.continue'", () => {
    const idx = buildPathReverseIndex([trait("forky", ["talk.fork"])]);
    const hits = lookupKnowledgeByPaths(idx, new Set(["talk", "talk.continue"]));
    expect(hits).toEqual([]);
  });

  test("dedup: same trait id from multiple exact-match paths counted once", () => {
    const t = trait("multi", ["talk", "submit.talk"]);
    const idx = buildPathReverseIndex([t]);
    /* Both "talk" and "submit.talk" are in activePaths → multi hits twice, deduplicated */
    const hits = lookupKnowledgeByPaths(idx, new Set(["talk", "talk.fork", "submit", "submit.talk"]));
    expect(hits).toEqual([{ id: "kernel:multi", presentation: "full", matchedPath: "talk" }]);
  });
});

describe("computeKnowledgeRefs from form_match source", () => {
  test("active path emits a KnowledgeRef per matched trait (exact match, parent paths explicit)", () => {
    /* deriveCommandPaths("talk", {context:"continue",type:"relation_update"}) returns
     * ["talk","talk.continue","talk.relation_update","talk.continue.relation_update"]
     * so activePaths contains "talk" (exact match for talkable) and
     * "talk.continue.relation_update" (exact match for relation_update). */
    const traits = [
      trait("talkable", ["talk"]),
      trait("relation_update", ["talk.continue.relation_update"]),
    ];
    const refs = computeKnowledgeRefs({
      traits,
      activePaths: new Set(["talk", "talk.continue", "talk.relation_update", "talk.continue.relation_update"]),
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

  test("description-only match emits summary and does not imply full content", () => {
    const refs = computeKnowledgeRefs({
      traits: [trait("talkable", [], ["talk"])],
      activePaths: new Set(["talk"]),
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]!.ref).toBe("@trait:talkable");
    expect(refs[0]!.presentation).toBe("summary");
  });
});

function view(name: string, paths: string[]): TraitDefinition {
  return {
    namespace: "self", name, kind: "view", type: "how_to_think",
    version: "1.0.0", description: "",
    readme: `# ${name}`, deps: [],
    activatesOn: { showContentWhen: paths },
    dir: `/fake/view/${name}`,
  };
}

describe("computeKnowledgeRefs emits view as type='view'", () => {
  test("view activated via path produces KnowledgeRef of type view", () => {
    const items = [view("status_page", ["talk"])];
    const refs = computeKnowledgeRefs({ traits: items, activePaths: new Set(["talk"]) });
    expect(refs).toHaveLength(1);
    expect(refs[0]!.type).toBe("view");
    expect(refs[0]!.ref).toBe("@view:status_page");
  });

  test("trait and view emitted with their respective types in same call", () => {
    const items: TraitDefinition[] = [
      // trait — kind defaults to "trait"
      {
        namespace: "kernel", name: "talkable", kind: "trait", type: "how_to_think",
        version: "1.0.0", description: "", readme: "", deps: [],
        activatesOn: { showContentWhen: ["talk"] }, dir: "/fake/talkable",
      },
      view("status_page", ["talk"]),
    ];
    const refs = computeKnowledgeRefs({ traits: items, activePaths: new Set(["talk"]) });
    const types = refs.map((r) => `${r.type}:${r.ref}`).sort();
    expect(types).toEqual(["trait:@trait:talkable", "view:@view:status_page"]);
  });
});

describe("computeKnowledgeRefs emits relation refs from peers list", () => {
  test("each peer becomes a summary-presentation relation ref", () => {
    const refs = computeKnowledgeRefs({
      traits: [],
      activePaths: new Set(),
      peers: ["bob", "carol"],
    });
    const rels = refs.filter((r) => r.type === "relation");
    expect(rels.map((r) => r.ref).sort()).toEqual(["@relation:bob", "@relation:carol"]);
    expect(rels.every((r) => r.presentation === "summary")).toBe(true);
    expect(rels.every((r) => r.source.kind === "relation")).toBe(true);
  });

  test("peers + form_match emit refs of all three kinds in same call", () => {
    /* activePaths must include "talk" directly for talkable to match (exact) */
    const refs = computeKnowledgeRefs({
      traits: [
        {
          namespace: "kernel", name: "talkable", kind: "trait", type: "how_to_think",
          version: "1.0.0", description: "", readme: "", deps: [], activatesOn: { showContentWhen: ["talk"] }, dir: "/fake/talkable",
        },
      ],
      activePaths: new Set(["talk", "talk.continue"]),
      peers: ["alice"],
    });
    const summary = refs.map((r) => `${r.type}/${r.ref}/${r.presentation}`).sort();
    expect(summary).toEqual([
      "relation/@relation:alice/summary",
      "trait/@trait:talkable/full",
    ]);
  });

  test("undefined peers input emits no relation refs", () => {
    const refs = computeKnowledgeRefs({ traits: [], activePaths: new Set() });
    expect(refs.filter((r) => r.type === "relation")).toEqual([]);
  });
});
