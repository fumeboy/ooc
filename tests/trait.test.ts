/**
 * Trait 系统测试
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTrait, loadAllTraits } from "../src/trait/loader.js";
import { MethodRegistry } from "../src/trait/registry.js";
import { getActiveTraits } from "../src/trait/activator.js";
import type { TraitDefinition } from "../src/types/index.js";

const TEST_DIR = join(import.meta.dir, ".tmp_trait_test");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("loadTrait", () => {
  test("加载只有 readme.md 的 trait", async () => {
    const traitDir = join(TEST_DIR, "my_trait");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "readme.md"),
      `---\nwhen: always\n---\n你应该认真思考。`,
      "utf-8",
    );

    const trait = await loadTrait(traitDir, "my_trait");
    expect(trait).not.toBeNull();
    expect(trait!.name).toBe("my_trait");
    expect(trait!.when).toBe("always");
    expect(trait!.readme).toBe("你应该认真思考。");
    expect(trait!.methods).toHaveLength(0);
  });

  test("加载有 index.ts 的 trait", async () => {
    const traitDir = join(TEST_DIR, "calc");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "readme.md"),
      `---\nwhen: always\n---\n计算能力`,
      "utf-8",
    );
    writeFileSync(
      join(traitDir, "index.ts"),
      `export const methods = {
        add: {
          description: "加法",
          params: [
            { name: "a", type: "number", description: "被加数", required: true },
            { name: "b", type: "number", description: "加数", required: true },
          ],
          fn: async (_ctx, a, b) => a + b,
        }
      };`,
      "utf-8",
    );

    const trait = await loadTrait(traitDir, "calc");
    expect(trait).not.toBeNull();
    expect(trait!.methods).toHaveLength(1);
    expect(trait!.methods[0]!.name).toBe("add");
    expect(trait!.methods[0]!.params).toHaveLength(2);
  });

  test("加载不存在的目录返回 null", async () => {
    const result = await loadTrait(join(TEST_DIR, "nonexistent"), "nope");
    expect(result).toBeNull();
  });

  test("解析 frontmatter description", async () => {
    const traitDir = join(TEST_DIR, "desc_trait");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "readme.md"),
      `---\nwhen: always\ndescription: "一行摘要"\n---\n完整内容`,
      "utf-8",
    );
    const trait = await loadTrait(traitDir, "desc_trait");
    expect(trait!.description).toBe("一行摘要");
  });

  test("无 description 时默认空字符串", async () => {
    const traitDir = join(TEST_DIR, "no_desc");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "readme.md"),
      `---\nwhen: always\n---\n内容`,
      "utf-8",
    );
    const trait = await loadTrait(traitDir, "no_desc");
    expect(trait!.description).toBe("");
  });
});

describe("loadAllTraits", () => {
  test("合并 kernel 和对象 traits", async () => {
    const kernelDir = join(TEST_DIR, "kernel");
    const objectDir = join(TEST_DIR, "object");

    /* kernel trait */
    mkdirSync(join(kernelDir, "computable"), { recursive: true });
    writeFileSync(join(kernelDir, "computable", "readme.md"), "---\nwhen: always\n---\n程序执行", "utf-8");

    /* object trait */
    mkdirSync(join(objectDir, "search"), { recursive: true });
    writeFileSync(join(objectDir, "search", "readme.md"), "---\nwhen: always\n---\n搜索能力", "utf-8");

    const traits = await loadAllTraits(objectDir, kernelDir);
    expect(traits).toHaveLength(2);
    expect(traits.map((t) => t.name).sort()).toEqual(["computable", "search"]);
  });

  test("对象 trait 覆盖 kernel 同名 trait", async () => {
    const kernelDir = join(TEST_DIR, "kernel2");
    const objectDir = join(TEST_DIR, "object2");

    mkdirSync(join(kernelDir, "computable"), { recursive: true });
    writeFileSync(join(kernelDir, "computable", "readme.md"), "---\nwhen: always\n---\nkernel版本", "utf-8");

    mkdirSync(join(objectDir, "computable"), { recursive: true });
    writeFileSync(join(objectDir, "computable", "readme.md"), "---\nwhen: always\n---\n对象覆盖版本", "utf-8");

    const traits = await loadAllTraits(objectDir, kernelDir);
    expect(traits).toHaveLength(1);
    expect(traits[0]!.readme).toBe("对象覆盖版本");
  });
});

describe("getActiveTraits", () => {
  test("激活 always 的 traits，不激活条件 trait", () => {
    const traits: TraitDefinition[] = [
      { name: "a", when: "always", description: "", readme: "A", methods: [], deps: [] },
      { name: "b", when: "never", description: "", readme: "B", methods: [], deps: [] },
      { name: "c", when: "当需要时", description: "", readme: "C", methods: [], deps: [] },
    ];

    const active = getActiveTraits(traits);
    expect(active.map((t) => t.name)).toContain("a");
    expect(active.map((t) => t.name)).not.toContain("b");
    expect(active.map((t) => t.name)).not.toContain("c");
  });

  test("手动激活条件 trait", () => {
    const traits: TraitDefinition[] = [
      { name: "a", when: "always", description: "", readme: "A", methods: [], deps: [] },
      { name: "obj_create", when: "当需要创建新对象时", description: "", readme: "OC", methods: [], deps: [] },
      { name: "file_ops", when: "当需要操作文件系统时", description: "", readme: "FO", methods: [], deps: [] },
    ];

    const active = getActiveTraits(traits, ["obj_create"]);
    expect(active.map((t) => t.name)).toContain("a");
    expect(active.map((t) => t.name)).toContain("obj_create");
    expect(active.map((t) => t.name)).not.toContain("file_ops");
  });

  test("依赖自动激活", () => {
    const traits: TraitDefinition[] = [
      { name: "base", when: "never", description: "", readme: "Base", methods: [], deps: [] },
      { name: "child", when: "always", description: "", readme: "Child", methods: [], deps: ["base"] },
    ];

    const active = getActiveTraits(traits);
    expect(active.map((t) => t.name)).toContain("base");
    expect(active.map((t) => t.name)).toContain("child");
  });
});

describe("MethodRegistry", () => {
  test("注册并查找方法", () => {
    const registry = new MethodRegistry();
    const traits: TraitDefinition[] = [
      {
        name: "math",
        when: "always",
        description: "",
        readme: "",
        methods: [
          {
            name: "add",
            description: "加法",
            params: [],
            fn: async (_ctx: unknown, a: unknown, b: unknown) => (a as number) + (b as number),
          },
        ],
        deps: [],
      },
    ];

    registry.registerAll(traits);
    expect(registry.names()).toContain("add");
    expect(registry.get("add")!.traitName).toBe("math");
  });

  test("构建沙箱方法", async () => {
    const registry = new MethodRegistry();
    const traits: TraitDefinition[] = [
      {
        name: "math",
        when: "always",
        description: "",
        readme: "",
        methods: [
          {
            name: "multiply",
            description: "乘法",
            params: [],
            fn: async (_ctx: unknown, a: unknown, b: unknown) => (a as number) * (b as number),
          },
        ],
        deps: [],
      },
    ];

    registry.registerAll(traits);

    const ctx = {
      data: {},
      setData: () => {},
      print: () => {},
      taskId: "t1",
      sharedDir: "/tmp",
    };

    const methods = registry.buildSandboxMethods(ctx);
    const result = await methods.multiply!(3, 4);
    expect(result).toBe(12);
  });

  test("buildSandboxMethods 传递 rootDir/selfDir/stoneName", async () => {
    const registry = new MethodRegistry();
    const traits: TraitDefinition[] = [
      {
        name: "inspector",
        when: "always",
        description: "",
        readme: "",
        methods: [
          {
            name: "inspectCtx",
            description: "返回 ctx 中的新字段",
            params: [],
            /** 方法接收 ctx，返回三个新字段 */
            fn: async (ctx: Record<string, unknown>) => ({
              rootDir: ctx.rootDir,
              selfDir: ctx.selfDir,
              stoneName: ctx.stoneName,
            }),
          },
        ],
        deps: [],
      },
    ];

    registry.registerAll(traits);

    const ctx = {
      data: {},
      getData: () => undefined,
      setData: () => {},
      print: () => {},
      taskId: "t1",
      filesDir: "/tmp/files",
      rootDir: "/home/user/project",
      selfDir: "/home/user/project/stones/alice",
      stoneName: "alice",
    };

    const methods = registry.buildSandboxMethods(ctx);
    const result = (await methods.inspectCtx!()) as Record<string, unknown>;
    expect(result.rootDir).toBe("/home/user/project");
    expect(result.selfDir).toBe("/home/user/project/stones/alice");
    expect(result.stoneName).toBe("alice");
  });
});
