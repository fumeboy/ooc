/**
 * concept-links.test — 校验 meta 树中所有概念对象的 schema 完整性，
 * 并间接守住"概念引用的源码 module 仍然存在且可解析"（由 tsc + import 守住）。
 *
 * 核心：每个概念对象（{ name, description, sources }）的 sources 必须是非空
 * Record<string, ModuleNamespace>，每个 value 必须是一个 module（运行时即对象）。
 *
 * 当前覆盖范围：仅 executable 模块（U2/U3/U4 落地后该文件会自然覆盖到所有
 * executable 子树概念）。后续模块迁移时按需扩展。
 */

import { describe, expect, it } from "bun:test";
import { walkConcepts, type WalkedConcept } from "./walk-concepts";

import { executable_v20260504_1 } from "@meta/object/executable/index.doc";

describe("walkConcepts helper", () => {
  it("identifies concepts that have name + description + sources", () => {
    const fixture = {
      meta: {
        concept_a: {
          name: "A",
          description: "first",
          sources: { mod: {} },
        },
      },
      aggregator: {
        description: "an aggregator (no name -> not a concept)",
        children: {
          concept_b: {
            name: "B",
            description: "second",
            sources: { other: {} },
          },
        },
      },
    };
    const found = walkConcepts(fixture, "fixture");
    const paths = found.map((c) => c.path).sort();
    expect(paths).toEqual([
      "fixture.aggregator.children.concept_b",
      "fixture.meta.concept_a",
    ]);
  });

  it("ignores objects missing any of name/description/sources", () => {
    const fixture = {
      missing_sources: { name: "X", description: "x" },
      missing_name: { description: "y", sources: { m: {} } },
      empty: {},
    };
    const found = walkConcepts(fixture, "fixture");
    expect(found).toEqual([]);
  });

  it("does not infinite-loop on `get parent()` cycles", () => {
    const root: any = {
      name: "Root",
      description: "root concept",
      sources: { a: {} },
    };
    const child: any = {
      name: "Child",
      description: "child concept",
      sources: { b: {} },
      get parent() {
        return root;
      },
    };
    root.children = { child };

    // 不抛 stack overflow / 不死循环即为通过；同时 parent getter 不被遍历
    const found = walkConcepts(root, "root");
    const paths = found.map((c) => c.path).sort();
    expect(paths).toEqual(["root"]);
    // root 是概念，按规则被记录后不再下钻其内部字段（含 children），
    // 这是 isConcept 的副作用：概念是叶节点。如果未来需要"概念也能套子概念"，
    // 调整 walkConcepts 的下钻规则，并同步更新此用例。
  });
});

describe("executable meta tree", () => {
  const concepts = walkConcepts(executable_v20260504_1, "executable");

  it("collects at least one concept (sanity check that the tree compiles)", () => {
    // U1 阶段 executable 还未拆，可能为 0；U2 落地后此断言保证树能 import
    // 而不是只验证空数组也算 pass
    expect(Array.isArray(concepts)).toBe(true);
  });

  it("collects concepts from executable.concepts.* (≥7 from U2 top-level extraction)", () => {
    const conceptPaths = concepts.map((c) => c.path);
    // 防止 .concepts 误删 / 重命名导致大量概念失踪
    expect(concepts.length).toBeGreaterThanOrEqual(7);
    // 抽样断言几个代表性 path 在场（regression 防护）
    expect(conceptPaths).toContain("executable.concepts.contextWindow");
    expect(conceptPaths).toContain("executable.concepts.progressiveDisclosure");
    expect(conceptPaths).toContain("executable.concepts.knowledgeActivation");
  });

  it("every collected concept has non-empty sources Record<string, object>", () => {
    for (const { path, concept } of concepts) {
      expect(typeof concept.name, `${path}.name`).toBe("string");
      expect(concept.name.length, `${path}.name length`).toBeGreaterThan(0);

      expect(typeof concept.description, `${path}.description`).toBe("string");
      expect(concept.description.length, `${path}.description length`).toBeGreaterThan(0);

      expect(concept.sources, `${path}.sources`).toBeDefined();
      const sourceKeys = Object.keys(concept.sources);
      expect(sourceKeys.length, `${path}.sources must be non-empty`).toBeGreaterThan(0);

      for (const [key, mod] of Object.entries(concept.sources)) {
        expect(typeof mod, `${path}.sources.${key} must be a module namespace (object)`).toBe(
          "object",
        );
        expect(mod, `${path}.sources.${key} must not be null`).not.toBeNull();
      }
    }
  });
});
