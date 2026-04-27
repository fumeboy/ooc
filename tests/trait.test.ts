/**
 * Trait 系统测试
 *
 * Phase 1 改造后：loadTrait 签名从 (dir, name, namespace) 变为 (dir, expectedNamespace)；
 * traitId 从 "namespace/name" 变为 "namespace:name"；
 * 只允许三个 namespace：kernel | library | self。
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTrait, loadAllTraits, loadTraitsByRef } from "../src/extendable/trait/loader.js";
import { getActiveTraits, traitId } from "../src/extendable/knowledge/activator.js";
import type { TraitDefinition } from "../src/shared/types/index.js";

const TEST_DIR = join(import.meta.dir, ".tmp_trait_test");

/** 新建一个最小化 TraitDefinition，便于测试用例构造 */
function mkTrait(partial: Partial<TraitDefinition> & { namespace: TraitDefinition["namespace"]; name: string }): TraitDefinition {
  return {
    kind: "trait",
    type: "how_to_think",
    description: "",
    readme: "",
    deps: [],
    ...partial,
  };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("loadTrait", () => {
  test("加载只有 TRAIT.md 的 trait", async () => {
    const traitDir = join(TEST_DIR, "kernel", "my_trait");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "TRAIT.md"),
      `---
namespace: kernel
name: my_trait
type: how_to_think
---
你应该认真思考。`,
      "utf-8",
    );

    const trait = await loadTrait(traitDir, "kernel");
    expect(trait).not.toBeNull();
    expect(trait!.namespace).toBe("kernel");
    expect(trait!.name).toBe("my_trait");
    expect(traitId(trait!)).toBe("kernel:my_trait");
    expect(trait!.kind).toBe("trait");
    expect(trait!.type).toBe("how_to_think");
    expect(trait!.readme).toBe("你应该认真思考。");
  });

  test("加载有 index.ts 的 trait", async () => {
    const traitDir = join(TEST_DIR, "library", "calc");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "TRAIT.md"),
      `---
namespace: library
name: calc
type: how_to_think
---
计算能力`,
      "utf-8",
    );
    writeFileSync(
      join(traitDir, "index.ts"),
      `export const llm_methods = {
        add: {
          description: "加法",
          params: [
            { name: "a", type: "number", description: "被加数", required: true },
            { name: "b", type: "number", description: "加数", required: true },
          ],
          fn: async (_ctx, { a, b }) => a + b,
        }
      };`,
      "utf-8",
    );

    const trait = await loadTrait(traitDir, "library");
    expect(trait).not.toBeNull();
    expect(Object.keys(trait!.llmMethods ?? {})).toEqual(["add"]);
    expect(trait!.llmMethods!.add!.params).toHaveLength(2);
  });

  test("加载不存在的目录返回 null", async () => {
    const result = await loadTrait(join(TEST_DIR, "nonexistent"), null);
    expect(result).toBeNull();
  });

  test("解析 frontmatter description", async () => {
    const traitDir = join(TEST_DIR, "self_desc");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "TRAIT.md"),
      `---
namespace: self
name: desc_trait
type: how_to_think
description: "一行摘要"
---
完整内容`,
      "utf-8",
    );
    const trait = await loadTrait(traitDir, "self");
    expect(trait!.description).toBe("一行摘要");
  });

  test("无 description 时默认空字符串", async () => {
    const traitDir = join(TEST_DIR, "self_nodesc");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "TRAIT.md"),
      `---
namespace: self
name: no_desc
type: how_to_think
---
内容`,
      "utf-8",
    );
    const trait = await loadTrait(traitDir, "self");
    expect(trait!.description).toBe("");
  });

  test("SKILL.md 格式兼容", async () => {
    const traitDir = join(TEST_DIR, "lib_skill");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "SKILL.md"),
      `---
namespace: library
name: my_skill
type: how_to_use_tool
---
技能内容`,
      "utf-8",
    );

    const trait = await loadTrait(traitDir, "library");
    expect(trait).not.toBeNull();
    expect(traitId(trait!)).toBe("library:my_skill");
    expect(trait!.type).toBe("how_to_use_tool");
  });

  test("缺失 namespace 抛错", async () => {
    const traitDir = join(TEST_DIR, "missing_ns");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "TRAIT.md"),
      `---
name: foo
type: how_to_think
---
x`,
      "utf-8",
    );
    await expect(loadTrait(traitDir, null)).rejects.toThrow(/namespace/);
  });

  test("非法 namespace 抛错", async () => {
    const traitDir = join(TEST_DIR, "bad_ns");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "TRAIT.md"),
      `---
namespace: user
name: foo
type: how_to_think
---
x`,
      "utf-8",
    );
    await expect(loadTrait(traitDir, null)).rejects.toThrow(/namespace/);
  });

  test("expectedNamespace 与声明不符抛错", async () => {
    const traitDir = join(TEST_DIR, "ns_mismatch");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "TRAIT.md"),
      `---
namespace: library
name: foo
type: how_to_think
---
x`,
      "utf-8",
    );
    await expect(loadTrait(traitDir, "kernel")).rejects.toThrow(/namespace/);
  });

  test("name 含冒号抛错", async () => {
    const traitDir = join(TEST_DIR, "bad_name");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "TRAIT.md"),
      `---
namespace: self
name: "evil:name"
type: how_to_think
---
x`,
      "utf-8",
    );
    await expect(loadTrait(traitDir, "self")).rejects.toThrow(/name/);
  });
});

describe("traitId 函数", () => {
  test("生成 namespace:name 格式", () => {
    const trait = mkTrait({ namespace: "kernel", name: "computable" });
    expect(traitId(trait)).toBe("kernel:computable");
  });

  test("name 含 / 分级保留", () => {
    const trait = mkTrait({ namespace: "library", name: "lark/doc" });
    expect(traitId(trait)).toBe("library:lark/doc");
  });

  test("self namespace", () => {
    const trait = mkTrait({ namespace: "self", name: "reporter" });
    expect(traitId(trait)).toBe("self:reporter");
  });
});

describe("loadAllTraits", () => {
  test("合并 kernel、library、self 三源 traits", async () => {
    const kernelDir = join(TEST_DIR, "kr");
    const libraryDir = join(TEST_DIR, "lib");
    const objectDir = join(TEST_DIR, "self_obj");

    /* kernel trait */
    mkdirSync(join(kernelDir, "computable"), { recursive: true });
    writeFileSync(
      join(kernelDir, "computable", "TRAIT.md"),
      `---
namespace: kernel
name: computable
type: how_to_think
---
程序执行`,
      "utf-8",
    );

    /* library trait */
    mkdirSync(join(libraryDir, "lark"), { recursive: true });
    writeFileSync(
      join(libraryDir, "lark", "TRAIT.md"),
      `---
namespace: library
name: lark
type: how_to_use_tool
---
飞书能力`,
      "utf-8",
    );

    /* self trait（新签名：objectDir 下查 traits/） */
    mkdirSync(join(objectDir, "traits", "reporter"), { recursive: true });
    writeFileSync(
      join(objectDir, "traits", "reporter", "TRAIT.md"),
      `---
namespace: self
name: reporter
type: how_to_use_tool
---
报告能力`,
      "utf-8",
    );

    const { traits } = await loadAllTraits(objectDir, kernelDir, libraryDir);
    expect(traits).toHaveLength(3);
    expect(traits.map((t) => traitId(t)).sort()).toEqual([
      "kernel:computable",
      "library:lark",
      "self:reporter",
    ]);
  });

  test("self trait 覆盖 kernel 同 traitId 的 trait", async () => {
    const kernelDir = join(TEST_DIR, "kr2");
    const objectDir = join(TEST_DIR, "self2");

    /* kernel 下一个普通 trait */
    mkdirSync(join(kernelDir, "foo"), { recursive: true });
    writeFileSync(
      join(kernelDir, "foo", "TRAIT.md"),
      `---
namespace: kernel
name: foo
type: how_to_think
---
kernel版本`,
      "utf-8",
    );

    /* self 下创建同 traitId "kernel:foo" 是不允许的（namespace 被强制为 self）；
       这里用同名 self:foo 来测试 trait map 的合并覆盖不会丢失两者。
       新签名：objectDir 下查 traits/ 子目录。 */
    mkdirSync(join(objectDir, "traits", "foo"), { recursive: true });
    writeFileSync(
      join(objectDir, "traits", "foo", "TRAIT.md"),
      `---
namespace: self
name: foo
type: how_to_think
---
对象版本`,
      "utf-8",
    );

    const { traits } = await loadAllTraits(objectDir, kernelDir);
    expect(traits).toHaveLength(2);
    expect(traits.map((t) => traitId(t)).sort()).toEqual([
      "kernel:foo",
      "self:foo",
    ]);
  });
});

describe("getActiveTraits", () => {
  test("默认只激活 kernel:base，不激活其他 trait", () => {
    const traits: TraitDefinition[] = [
      mkTrait({ namespace: "kernel", name: "base", readme: "Base" }),
      mkTrait({ namespace: "kernel", name: "a", readme: "A" }),
      mkTrait({ namespace: "kernel", name: "c", readme: "C" }),
    ];

    const active = getActiveTraits(traits);
    const ids = active.map((t) => traitId(t));
    expect(ids).toContain("kernel:base");
    expect(ids).not.toContain("kernel:a");
    expect(ids).not.toContain("kernel:c");
  });

  test("手动激活条件 trait (scope 使用 namespace:name 格式)", () => {
    const traits: TraitDefinition[] = [
      mkTrait({ namespace: "kernel", name: "base", readme: "Base" }),
      mkTrait({ namespace: "library", name: "obj_create", type: "how_to_use_tool", readme: "OC" }),
      mkTrait({ namespace: "library", name: "file_ops", type: "how_to_use_tool", readme: "FO" }),
    ];

    const active = getActiveTraits(traits, ["library:obj_create"]);
    const ids = active.map((t) => traitId(t));
    expect(ids).toContain("kernel:base");
    expect(ids).toContain("library:obj_create");
    expect(ids).not.toContain("library:file_ops");
  });

  test("依赖自动激活 (deps 使用 namespace:name 格式)", () => {
    const traits: TraitDefinition[] = [
      mkTrait({ namespace: "kernel", name: "base", readme: "Base" }),
      mkTrait({ namespace: "library", name: "child", readme: "Child", deps: ["kernel:base"] }),
    ];

    const active = getActiveTraits(traits, ["library:child"]);
    const ids = active.map((t) => traitId(t));
    expect(ids).toContain("kernel:base");
    expect(ids).toContain("library:child");
  });
});

describe("loadTraitsByRef（_traits_ref 加载机制）", () => {
  test("只加载指定名称的 trait", async () => {
    const libDir = join(TEST_DIR, "lib_ref");
    /* 创建 3 个 library trait，只引用其中 2 个 */
    for (const name of ["search", "translate", "summarize"]) {
      const traitDir = join(libDir, name);
      mkdirSync(traitDir, { recursive: true });
      writeFileSync(
        join(traitDir, "TRAIT.md"),
        `---
namespace: library
name: ${name}
type: how_to_use_tool
---
${name}能力`,
        "utf-8",
      );
    }

    const traits = await loadTraitsByRef(libDir, ["search", "summarize"], "library");
    expect(traits).toHaveLength(2);
    expect(traits.map((t) => traitId(t)).sort()).toEqual([
      "library:search",
      "library:summarize",
    ]);
  });

  test("跳过不存在的 trait 名称", async () => {
    const libDir = join(TEST_DIR, "lib_skip");
    mkdirSync(join(libDir, "real"), { recursive: true });
    writeFileSync(
      join(libDir, "real", "TRAIT.md"),
      `---
namespace: library
name: real
type: how_to_think
---
存在`,
      "utf-8",
    );

    const traits = await loadTraitsByRef(libDir, ["real", "ghost", "phantom"], "library");
    expect(traits).toHaveLength(1);
    expect(traitId(traits[0]!)).toBe("library:real");
  });

  test("空 refs 数组返回空列表", async () => {
    const traits = await loadTraitsByRef(TEST_DIR, [], null);
    expect(traits).toHaveLength(0);
  });

  test("目录不存在时不报错", async () => {
    const traits = await loadTraitsByRef(join(TEST_DIR, "nonexistent_lib"), ["a", "b"], null);
    expect(traits).toHaveLength(0);
  });
});
