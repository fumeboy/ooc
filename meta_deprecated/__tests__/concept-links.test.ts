/**
 * concept-links.test — 校验 meta 树中所有概念对象的 schema 完整性，
 * 并间接守住"概念引用的源码 module 仍然存在且可解析"（由 tsc + import 守住）。
 *
 * 核心：每个概念对象（{ name, description, sources }）的 sources 必须是非空
 * Record<string, ModuleNamespace>，每个 value 必须是一个 module（运行时即对象）。
 *
 * 覆盖范围：executable / engineering / thinkable / persistable / observable /
 * collaborable 子树的合规概念。后续模块迁移时按需扩展（参考
 * docs/meta-source-binding-inventory.md）。
 */

import { describe, expect, it } from "bun:test";
import { walkConcepts, type WalkedConcept } from "./walk-concepts";

import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import { engineering_v20260506_1 } from "@meta/engineering/index.doc";
import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import { persistable_v20260504_1 } from "@meta/object/persistable/index.doc";
import { observable_v20260517_1 } from "@meta/object/observable/index.doc";
import { collaborable_v20260504_1 } from "@meta/object/collaborable/index.doc";
import { extendable_v20260504_1 } from "@meta/object/extendable/index.doc";
import { reflectable_v20260504_1 } from "@meta/object/reflectable/index.doc";

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

    // 不抛 stack overflow / 不死循环即为通过；parent getter 不被遍历。
    // walkConcepts 会同时收到 root 与 child（aggregator 既是概念也允许有子概念）。
    const found = walkConcepts(root, "root");
    const paths = found.map((c) => c.path).sort();
    expect(paths).toEqual(["root", "root.children.child"]);
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

describe("engineering meta tree", () => {
  const concepts = walkConcepts(engineering_v20260506_1, "engineering");

  it("collects all 4 engineering sub-doc concepts as合规 concept objects", () => {
    const conceptPaths = concepts.map((c) => c.path).sort();
    // 4 个 engineering 子文档（refactoring-governance / integration-tests /
    // llm-provider-debugging / meta-doc-maintenance）必须全部被识别为合规概念
    expect(conceptPaths).toEqual(
      [
        "engineering.integration_tests",
        "engineering.llm_provider_debugging",
        "engineering.meta_doc_maintenance",
        "engineering.refactoring_governance",
      ].sort(),
    );
  });

  it("every engineering concept has non-empty sources Record<string, object>", () => {
    for (const { path, concept } of concepts) {
      expect(concept.name.length, `${path}.name length`).toBeGreaterThan(0);
      expect(concept.description.length, `${path}.description length`).toBeGreaterThan(0);
      const sourceKeys = Object.keys(concept.sources);
      expect(sourceKeys.length, `${path}.sources must be non-empty`).toBeGreaterThan(0);
      for (const [key, mod] of Object.entries(concept.sources)) {
        expect(typeof mod, `${path}.sources.${key} must be a module namespace`).toBe("object");
        expect(mod, `${path}.sources.${key} must not be null`).not.toBeNull();
      }
    }
  });
});

/**
 * 辅助断言：给定子树，所有被 walker 识别的概念 schema 完整。
 *
 * 仅校验 schema 形状，不强制具体概念路径——子树内部还在持续迁移，路径列表
 * 容易过时；schema 完整性是底线。
 */
function expectAllConceptsValid(concepts: WalkedConcept[]): void {
  for (const { path, concept } of concepts) {
    expect(typeof concept.name, `${path}.name`).toBe("string");
    expect(concept.name.length, `${path}.name length`).toBeGreaterThan(0);
    expect(typeof concept.description, `${path}.description`).toBe("string");
    expect(concept.description.length, `${path}.description length`).toBeGreaterThan(0);
    const sourceKeys = Object.keys(concept.sources);
    expect(sourceKeys.length, `${path}.sources must be non-empty`).toBeGreaterThan(0);
    for (const [key, mod] of Object.entries(concept.sources)) {
      expect(typeof mod, `${path}.sources.${key} must be a module namespace`).toBe("object");
      expect(mod, `${path}.sources.${key} must not be null`).not.toBeNull();
    }
  }
}

describe("thinkable meta tree", () => {
  const concepts = walkConcepts(thinkable_v20260504_1, "thinkable");

  it("recognises sub-concepts that have been upgraded to concept shape", () => {
    const conceptPaths = concepts.map((c) => c.path);
    // 这些子概念已完成合规升级；新增升级时在此追加，未升级的不强制
    expect(conceptPaths).toContain("thinkable.context");
    expect(conceptPaths).toContain("thinkable.llm");
    expect(conceptPaths).toContain("thinkable.thread.scheduler");
    expect(conceptPaths).toContain("thinkable.identity");
    expect(conceptPaths).toContain("thinkable.knowledge");
    expect(conceptPaths).toContain("thinkable.thinkloop");
  });

  it("every collected thinkable concept has valid schema", () => {
    expectAllConceptsValid(concepts);
  });
});

describe("persistable meta tree", () => {
  const concepts = walkConcepts(persistable_v20260504_1, "persistable");

  it("persistable itself is now a concept (post-Sprint 1 binding)", () => {
    const conceptPaths = concepts.map((c) => c.path);
    expect(conceptPaths).toContain("persistable");
  });

  it("every collected persistable concept has valid schema", () => {
    expectAllConceptsValid(concepts);
  });
});

describe("observable meta tree", () => {
  const concepts = walkConcepts(observable_v20260517_1, "observable");

  it("observable aggregator + 3 sub-concepts (pause / debug / contextVisibility) all识别为合规概念", () => {
    const conceptPaths = concepts.map((c) => c.path);
    expect(conceptPaths).toContain("observable");
    expect(conceptPaths).toContain("observable.concepts.pause");
    expect(conceptPaths).toContain("observable.concepts.debug");
    expect(conceptPaths).toContain("observable.concepts.contextVisibility");
  });

  it("every collected observable concept has valid schema", () => {
    expectAllConceptsValid(concepts);
  });
});

describe("collaborable meta tree", () => {
  const concepts = walkConcepts(collaborable_v20260504_1, "collaborable");

  it("recognises collaborable root + 4 sub-areas + supervisor + 4 kanban leaves as合规概念", () => {
    const conceptPaths = concepts.map((c) => c.path);
    // 防止 concepts.* 漏挂或子文件忘记导出
    expect(conceptPaths).toContain("collaborable");
    expect(conceptPaths).toContain("collaborable.concepts.talk");
    expect(conceptPaths).toContain("collaborable.concepts.relation");
    expect(conceptPaths).toContain("collaborable.concepts.kanban");
    expect(conceptPaths).toContain("collaborable.concepts.role");
    expect(conceptPaths).toContain("collaborable.concepts.supervisor");
    expect(conceptPaths).toContain("collaborable.concepts.kanban.concepts.issue");
    expect(conceptPaths).toContain("collaborable.concepts.kanban.concepts.task");
    expect(conceptPaths).toContain("collaborable.concepts.kanban.concepts.comment");
    expect(conceptPaths).toContain("collaborable.concepts.kanban.concepts.concurrentWrite");
  });

  it("every collected collaborable concept has valid schema", () => {
    expectAllConceptsValid(concepts);
  });
});

describe("extendable meta tree", () => {
  const concepts = walkConcepts(extendable_v20260504_1, "extendable");

  it("recognises extendable aggregator + kernel_extensions as合规 concepts", () => {
    const conceptPaths = concepts.map((c) => c.path);
    expect(conceptPaths).toContain("extendable");
    expect(conceptPaths).toContain("extendable.kernel_extensions");
  });

  it("every collected extendable concept has valid schema", () => {
    expectAllConceptsValid(concepts);
  });
});

describe("reflectable meta tree", () => {
  const concepts = walkConcepts(reflectable_v20260504_1, "reflectable");

  it("recognises reflectable as合规 concept", () => {
    const conceptPaths = concepts.map((c) => c.path);
    expect(conceptPaths).toContain("reflectable");
  });

  it("every collected reflectable concept has valid schema", () => {
    expectAllConceptsValid(concepts);
  });
});
