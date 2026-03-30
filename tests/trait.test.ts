/**
 * Trait 系统测试
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTrait, loadAllTraits, loadTraitsByRef } from "../src/trait/loader.js";
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

describe("loadTraitsByRef（_traits_ref 加载机制）", () => {
  test("只加载指定名称的 trait", async () => {
    const libDir = join(TEST_DIR, "library");
    /* 创建 3 个 trait，只引用其中 2 个 */
    for (const name of ["search", "translate", "summarize"]) {
      mkdirSync(join(libDir, name), { recursive: true });
      writeFileSync(join(libDir, name, "readme.md"), `---\nwhen: always\n---\n${name}能力`, "utf-8");
    }

    const traits = await loadTraitsByRef(libDir, ["search", "summarize"]);
    expect(traits).toHaveLength(2);
    expect(traits.map(t => t.name).sort()).toEqual(["search", "summarize"]);
  });

  test("跳过不存在的 trait 名称", async () => {
    const libDir = join(TEST_DIR, "lib_skip");
    mkdirSync(join(libDir, "real"), { recursive: true });
    writeFileSync(join(libDir, "real", "readme.md"), "---\nwhen: always\n---\n存在", "utf-8");

    const traits = await loadTraitsByRef(libDir, ["real", "ghost", "phantom"]);
    expect(traits).toHaveLength(1);
    expect(traits[0]!.name).toBe("real");
  });

  test("空 refs 数组返回空列表", async () => {
    const libDir = join(TEST_DIR, "lib_empty");
    mkdirSync(join(libDir, "something"), { recursive: true });
    writeFileSync(join(libDir, "something", "readme.md"), "---\nwhen: always\n---\n内容", "utf-8");

    const traits = await loadTraitsByRef(libDir, []);
    expect(traits).toHaveLength(0);
  });

  test("目录不存在时不报错", async () => {
    const traits = await loadTraitsByRef(join(TEST_DIR, "nonexistent_lib"), ["a", "b"]);
    expect(traits).toHaveLength(0);
  });
});

describe("方法可见性过滤", () => {
  test("buildSandboxMethods 只注入 activatedTraits 中的方法", async () => {
    const registry = new MethodRegistry();
    registry.registerAll([
      {
        name: "trait_a", when: "always", description: "", readme: "",
        methods: [{ name: "methodA", description: "", params: [], fn: async () => "a", needsCtx: false }],
        deps: [],
      },
      {
        name: "trait_b", when: "always", description: "", readme: "",
        methods: [{ name: "methodB", description: "", params: [], fn: async () => "b", needsCtx: false }],
        deps: [],
      },
    ]);

    const ctx = {
      data: {}, getData: () => undefined, setData: () => {},
      print: () => {}, taskId: "t", filesDir: "/tmp",
      rootDir: "/tmp", selfDir: "/tmp", stoneName: "test",
    } as any;

    // 只激活 trait_a → 只注入 trait_a.methodA
    const sandbox = registry.buildSandboxMethods(ctx, ["trait_a"]);
    expect(sandbox.trait_a).toBeDefined();
    expect((sandbox.trait_a as any).methodA).toBeDefined();
    expect(sandbox.trait_b).toBeUndefined();

    // 验证两段式调用
    const result = await (sandbox.trait_a as any).methodA();
    expect(result).toBe("a");

    // 扁平调用不再可用（避免命名冲突）
    expect(sandbox.methodA).toBeUndefined();
    expect(sandbox.methodB).toBeUndefined();

    // 激活全部
    const sandboxAll = registry.buildSandboxMethods(ctx, ["trait_a", "trait_b"]);
    expect(sandboxAll.trait_a).toBeDefined();
    expect(sandboxAll.trait_b).toBeDefined();
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
      filesDir: "/tmp",
      rootDir: "/tmp",
      selfDir: "/tmp",
      stoneName: "test",
    } as any;

    // 两段式调用：traitName.methodName()
    const methods = registry.buildSandboxMethods(ctx, ["math"]);
    expect(methods.math).toBeDefined();
    const result = await (methods.math as any).multiply(3, 4);
    expect(result).toBe(12);

    // 扁平调用不再可用
    expect(methods.multiply).toBeUndefined();
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
    } as any;

    // 两段式调用：inspector.inspectCtx()
    const methods = registry.buildSandboxMethods(ctx, ["inspector"]);
    expect(methods.inspector).toBeDefined();
    const result = (await (methods.inspector as any).inspectCtx()) as Record<string, unknown>;
    expect(result.rootDir).toBe("/home/user/project");
    expect(result.selfDir).toBe("/home/user/project/stones/alice");
    expect(result.stoneName).toBe("alice");

    // 扁平调用不再可用
    expect(methods.inspectCtx).toBeUndefined();
  });

  test("两段式方法调用 traitName.methodName()", async () => {
    const registry = new MethodRegistry();
    const traits: TraitDefinition[] = [
      {
        name: "math_basic",
        when: "never",
        description: "基础数学",
        readme: "",
        methods: [
          {
            name: "add",
            description: "加法",
            params: [],
            fn: async (_ctx: unknown, a: unknown, b: unknown) => (a as number) + (b as number),
          },
          {
            name: "subtract",
            description: "减法",
            params: [],
            fn: async (_ctx: unknown, a: unknown, b: unknown) => (a as number) - (b as number),
          },
        ],
        deps: [],
      },
      {
        name: "string_utils",
        when: "never",
        description: "字符串工具",
        readme: "",
        methods: [
          {
            name: "concat",
            description: "连接字符串",
            params: [],
            fn: async (_ctx: unknown, a: unknown, b: unknown) => (a as string) + (b as string),
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
      filesDir: "/tmp",
      rootDir: "/tmp",
      selfDir: "/tmp",
      stoneName: "test",
    } as any;

    // 激活 math_basic 和 string_utils
    const methods = registry.buildSandboxMethods(ctx, ["math_basic", "string_utils"]);

    // 验证两段式调用：traitName.methodName()
    expect(methods.math_basic).toBeDefined();
    expect((methods.math_basic as any).add).toBeDefined();
    expect((methods.math_basic as any).subtract).toBeDefined();
    expect(methods.string_utils).toBeDefined();
    expect((methods.string_utils as any).concat).toBeDefined();

    // 验证两段式调用能正常工作
    const addResult = await (methods.math_basic as any).add(2, 3);
    expect(addResult).toBe(5);

    const subtractResult = await (methods.math_basic as any).subtract(10, 3);
    expect(subtractResult).toBe(7);

    const concatResult = await (methods.string_utils as any).concat("Hello, ", "World!");
    expect(concatResult).toBe("Hello, World!");

    // 验证不再有扁平调用（避免命名冲突）
    expect(methods.add).toBeUndefined();
    expect(methods.subtract).toBeUndefined();
    expect(methods.concat).toBeUndefined();
  });

  test("buildSandboxMethods 按 activatedTraits 过滤方法", async () => {
    const registry = new MethodRegistry();
    const traits: TraitDefinition[] = [
      {
        name: "trait_a",
        when: "never",
        description: "",
        readme: "",
        methods: [
          { name: "methodA", description: "", params: [], fn: async () => "A" },
        ],
        deps: [],
      },
      {
        name: "trait_b",
        when: "never",
        description: "",
        readme: "",
        methods: [
          { name: "methodB", description: "", params: [], fn: async () => "B" },
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
      filesDir: "/tmp",
      rootDir: "/tmp",
      selfDir: "/tmp",
      stoneName: "test",
    } as any;

    // 只激活 trait_a
    const methods = registry.buildSandboxMethods(ctx, ["trait_a"]);

    // trait_a 的方法应该可用（两段式调用）
    expect(methods.trait_a).toBeDefined();
    expect((methods.trait_a as any).methodA).toBeDefined();

    // trait_b 的方法应该不可用
    expect(methods.trait_b).toBeUndefined();

    // 不再有扁平调用（避免命名冲突）
    expect(methods.methodA).toBeUndefined();
    expect(methods.methodB).toBeUndefined();

    // 激活全部时所有 trait 都可用
    const allMethods = registry.buildSandboxMethods(ctx, ["trait_a", "trait_b"]);
    expect(allMethods.trait_a).toBeDefined();
    expect(allMethods.trait_b).toBeDefined();
  });
});
