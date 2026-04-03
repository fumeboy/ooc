/**
 * Trait 系统测试
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTrait, loadAllTraits, loadTraitsByRef } from "../src/trait/loader.js";
import { MethodRegistry } from "../src/trait/registry.js";
import { getActiveTraits, traitId } from "../src/trait/activator.js";
import type { TraitDefinition } from "../src/types/index.js";

const TEST_DIR = join(import.meta.dir, ".tmp_trait_test");

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
namespace: "kernel"
name: "my_trait"
type: "how_to_think"
when: always
---
你应该认真思考。`,
      "utf-8",
    );

    const trait = await loadTrait(traitDir, "my_trait", "kernel");
    expect(trait).not.toBeNull();
    expect(trait!.namespace).toBe("kernel");
    expect(trait!.name).toBe("my_trait");
    expect(trait!.type).toBe("how_to_think");
    expect(trait!.when).toBe("always");
    expect(trait!.readme).toBe("你应该认真思考。");
    expect(trait!.methods).toHaveLength(0);
  });

  test("加载有 index.ts 的 trait", async () => {
    const traitDir = join(TEST_DIR, "math", "calc");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "TRAIT.md"),
      `---
namespace: "math"
name: "calc"
type: "how_to_think"
when: always
---
计算能力`,
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

    const trait = await loadTrait(traitDir, "calc", "math");
    expect(trait).not.toBeNull();
    expect(trait!.methods).toHaveLength(1);
    expect(trait!.methods[0]!.name).toBe("add");
    expect(trait!.methods[0]!.params).toHaveLength(2);
  });

  test("加载不存在的目录返回 null", async () => {
    const result = await loadTrait(join(TEST_DIR, "nonexistent"), "nope", "test");
    expect(result).toBeNull();
  });

  test("解析 frontmatter description", async () => {
    const traitDir = join(TEST_DIR, "test", "desc_trait");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "TRAIT.md"),
      `---
namespace: "test"
name: "desc_trait"
type: "how_to_think"
when: always
description: "一行摘要"
---
完整内容`,
      "utf-8",
    );
    const trait = await loadTrait(traitDir, "desc_trait", "test");
    expect(trait!.description).toBe("一行摘要");
  });

  test("无 description 时默认空字符串", async () => {
    const traitDir = join(TEST_DIR, "test", "no_desc");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "TRAIT.md"),
      `---
namespace: "test"
name: "no_desc"
type: "how_to_think"
when: always
---
内容`,
      "utf-8",
    );
    const trait = await loadTrait(traitDir, "no_desc", "test");
    expect(trait!.description).toBe("");
  });

  test("SKILL.md 格式兼容", async () => {
    const traitDir = join(TEST_DIR, "skills", "my_skill");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "SKILL.md"),
      `---
namespace: "skills"
name: "my_skill"
type: "how_to_use_tool"
when: always
---
技能内容`,
      "utf-8",
    );

    const trait = await loadTrait(traitDir, "my_skill", "skills");
    expect(trait).not.toBeNull();
    expect(trait!.namespace).toBe("skills");
    expect(trait!.type).toBe("how_to_use_tool");
  });

  test("hooks 解析", async () => {
    const traitDir = join(TEST_DIR, "kernel", "hooked");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "TRAIT.md"),
      `---
namespace: "kernel"
name: "hooked"
type: "how_to_think"
when: always
hooks:
  before:
    inject_title: "开始前提醒"
    inject: "请仔细阅读文档"
    once: true
  when_finish: "完成了"
---
内容`,
      "utf-8",
    );

    const trait = await loadTrait(traitDir, "hooked", "kernel");
    expect(trait!.hooks).toBeDefined();
    expect(trait!.hooks!.before).toBeDefined();
    expect(trait!.hooks!.before!.inject_title).toBe("开始前提醒");
    expect(trait!.hooks!.before!.inject).toBe("请仔细阅读文档");
    expect(trait!.hooks!.when_finish).toBeDefined();
    expect(trait!.hooks!.when_finish!.inject).toBe("完成了");
  });
});

describe("traitId 函数", () => {
  test("生成 namespace/name 格式", () => {
    const trait: TraitDefinition = {
      namespace: "kernel",
      name: "computable",
      type: "how_to_think",
      when: "always",
      description: "",
      readme: "",
      methods: [],
      deps: [],
    };
    expect(traitId(trait)).toBe("kernel/computable");
  });

  test("空 namespace 也正确拼接", () => {
    const trait: TraitDefinition = {
      namespace: "",
      name: "old_style",
      type: "how_to_think",
      when: "always",
      description: "",
      readme: "",
      methods: [],
      deps: [],
    };
    expect(traitId(trait)).toBe("/old_style");
  });
});

describe("loadAllTraits", () => {
  test("合并 kernel 和对象 traits", async () => {
    const kernelDir = join(TEST_DIR, "kernel");
    const objectDir = join(TEST_DIR, "object");

    /* kernel trait (新格式：kernel/computable) */
    mkdirSync(join(kernelDir, "kernel", "computable"), { recursive: true });
    writeFileSync(
      join(kernelDir, "kernel", "computable", "TRAIT.md"),
      `---
namespace: "kernel"
name: "computable"
type: "how_to_think"
when: always
---
程序执行`,
      "utf-8",
    );

    /* object trait (新格式：search/search) */
    mkdirSync(join(objectDir, "search", "search"), { recursive: true });
    writeFileSync(
      join(objectDir, "search", "search", "TRAIT.md"),
      `---
namespace: "search"
name: "search"
type: "how_to_use_tool"
when: always
---
搜索能力`,
      "utf-8",
    );

    const traits = await loadAllTraits(objectDir, kernelDir);
    expect(traits).toHaveLength(2);
    expect(traits.map((t) => traitId(t)).sort()).toEqual(["kernel/computable", "search/search"]);
  });

  test("对象 trait 覆盖 kernel 同名 trait", async () => {
    const kernelDir = join(TEST_DIR, "kernel2");
    const objectDir = join(TEST_DIR, "object2");

    mkdirSync(join(kernelDir, "kernel", "computable"), { recursive: true });
    writeFileSync(
      join(kernelDir, "kernel", "computable", "TRAIT.md"),
      `---
namespace: "kernel"
name: "computable"
type: "how_to_think"
when: always
---
kernel版本`,
      "utf-8",
    );

    mkdirSync(join(objectDir, "kernel", "computable"), { recursive: true });
    writeFileSync(
      join(objectDir, "kernel", "computable", "TRAIT.md"),
      `---
namespace: "kernel"
name: "computable"
type: "how_to_think"
when: always
---
对象覆盖版本`,
      "utf-8",
    );

    const traits = await loadAllTraits(objectDir, kernelDir);
    expect(traits).toHaveLength(1);
    expect(traits[0]!.readme).toBe("对象覆盖版本");
  });
});

describe("getActiveTraits", () => {
  test("激活 always 的 traits，不激活条件 trait", () => {
    const traits: TraitDefinition[] = [
      { namespace: "kernel", name: "a", type: "how_to_think", when: "always", description: "", readme: "A", methods: [], deps: [] },
      { namespace: "kernel", name: "b", type: "how_to_think", when: "never", description: "", readme: "B", methods: [], deps: [] },
      { namespace: "kernel", name: "c", type: "how_to_think", when: "当需要时", description: "", readme: "C", methods: [], deps: [] },
    ];

    const active = getActiveTraits(traits);
    expect(active.map((t) => traitId(t))).toContain("kernel/a");
    expect(active.map((t) => traitId(t))).not.toContain("kernel/b");
    expect(active.map((t) => traitId(t))).not.toContain("kernel/c");
  });

  test("手动激活条件 trait (使用 namespace/name 格式)", () => {
    const traits: TraitDefinition[] = [
      { namespace: "kernel", name: "a", type: "how_to_think", when: "always", description: "", readme: "A", methods: [], deps: [] },
      { namespace: "tools", name: "obj_create", type: "how_to_use_tool", when: "当需要创建新对象时", description: "", readme: "OC", methods: [], deps: [] },
      { namespace: "tools", name: "file_ops", type: "how_to_use_tool", when: "当需要操作文件系统时", description: "", readme: "FO", methods: [], deps: [] },
    ];

    const active = getActiveTraits(traits, ["tools/obj_create"]);
    expect(active.map((t) => traitId(t))).toContain("kernel/a");
    expect(active.map((t) => traitId(t))).toContain("tools/obj_create");
    expect(active.map((t) => traitId(t))).not.toContain("tools/file_ops");
  });

  test("依赖自动激活 (deps 使用 namespace/name 格式)", () => {
    const traits: TraitDefinition[] = [
      { namespace: "base", name: "base", type: "how_to_think", when: "never", description: "", readme: "Base", methods: [], deps: [] },
      { namespace: "ext", name: "child", type: "how_to_think", when: "always", description: "", readme: "Child", methods: [], deps: ["base/base"] },
    ];

    const active = getActiveTraits(traits);
    expect(active.map((t) => traitId(t))).toContain("base/base");
    expect(active.map((t) => traitId(t))).toContain("ext/child");
  });
});

describe("loadTraitsByRef（_traits_ref 加载机制）", () => {
  test("只加载指定名称的 trait (namespace/name 格式)", async () => {
    const libDir = join(TEST_DIR, "library");
    /* 创建 3 个 trait，只引用其中 2 个 */
    for (const [ns, name] of [["search", "search"], ["translate", "translate"], ["summary", "summarize"]]) {
      const traitDir = join(libDir, ns, name);
      mkdirSync(traitDir, { recursive: true });
      writeFileSync(
        join(traitDir, "TRAIT.md"),
        `---
namespace: "${ns}"
name: "${name}"
type: "how_to_use_tool"
when: always
---
${name}能力`,
        "utf-8",
      );
    }

    const traits = await loadTraitsByRef(libDir, ["search/search", "summary/summarize"]);
    expect(traits).toHaveLength(2);
    expect(traits.map(t => traitId(t)).sort()).toEqual(["search/search", "summary/summarize"]);
  });

  test("跳过不存在的 trait 名称", async () => {
    const libDir = join(TEST_DIR, "lib_skip");
    mkdirSync(join(libDir, "real", "real"), { recursive: true });
    writeFileSync(
      join(libDir, "real", "real", "TRAIT.md"),
      `---
namespace: "real"
name: "real"
type: "how_to_think"
when: always
---
存在`,
      "utf-8",
    );

    const traits = await loadTraitsByRef(libDir, ["real/real", "ghost/ghost", "phantom/phantom"]);
    expect(traits).toHaveLength(1);
    expect(traitId(traits[0]!)).toBe("real/real");
  });

  test("空 refs 数组返回空列表", async () => {
    const libDir = join(TEST_DIR, "lib_empty");
    mkdirSync(join(libDir, "something", "something"), { recursive: true });
    writeFileSync(
      join(libDir, "something", "something", "TRAIT.md"),
      `---
namespace: "something"
name: "something"
type: "how_to_think"
when: always
---
内容`,
      "utf-8",
    );

    const traits = await loadTraitsByRef(libDir, []);
    expect(traits).toHaveLength(0);
  });

  test("目录不存在时不报错", async () => {
    const traits = await loadTraitsByRef(join(TEST_DIR, "nonexistent_lib"), ["a/a", "b/b"]);
    expect(traits).toHaveLength(0);
  });
});

describe("方法可见性过滤", () => {
  test("buildSandboxMethods 只注入 activatedTraits 中的方法", async () => {
    const registry = new MethodRegistry();
    registry.registerAll([
      {
        namespace: "t1",
        name: "trait_a",
        when: "always",
        type: "how_to_think",
        description: "",
        readme: "",
        methods: [{ name: "methodA", description: "", params: [], fn: async () => "a", needsCtx: false }],
        deps: [],
      },
      {
        namespace: "t2",
        name: "trait_b",
        when: "always",
        type: "how_to_think",
        description: "",
        readme: "",
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
    const sandbox = registry.buildSandboxMethods(ctx, ["t1/trait_a"]);
    expect(sandbox["t1/trait_a"]).toBeDefined();
    expect((sandbox["t1/trait_a"] as any).methodA).toBeDefined();
    expect(sandbox["t2/trait_b"]).toBeUndefined();

    // 验证两段式调用
    const result = await (sandbox["t1/trait_a"] as any).methodA();
    expect(result).toBe("a");

    // 扁平调用可用，但仅限已激活 trait 的方法
    expect(typeof sandbox.methodA).toBe("function");
    expect(sandbox.methodB).toBeUndefined();

    // 激活全部
    const sandboxAll = registry.buildSandboxMethods(ctx, ["t1/trait_a", "t2/trait_b"]);
    expect(sandboxAll["t1/trait_a"]).toBeDefined();
    expect(sandboxAll["t2/trait_b"]).toBeDefined();
  });
});

describe("MethodRegistry", () => {
  test("注册并查找方法", () => {
    const registry = new MethodRegistry();
    const traits: TraitDefinition[] = [
      {
        namespace: "math",
        name: "math",
        type: "how_to_think",
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
    expect(registry.get("add")!.traitName).toBe("math/math");
  });

  test("构建沙箱方法", async () => {
    const registry = new MethodRegistry();
    const traits: TraitDefinition[] = [
      {
        namespace: "math",
        name: "math",
        type: "how_to_think",
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

    // 两段式调用：namespace/traitName.methodName()
    const methods = registry.buildSandboxMethods(ctx, ["math/math"]);
    expect(methods["math/math"]).toBeDefined();
    const result = await (methods["math/math"] as any).multiply(3, 4);
    expect(result).toBe(12);

    // 扁平调用同样可用
    expect(typeof methods.multiply).toBe("function");
  });

  test("buildSandboxMethods 传递 rootDir/selfDir/stoneName", async () => {
    const registry = new MethodRegistry();
    const traits: TraitDefinition[] = [
      {
        namespace: "inspect",
        name: "inspector",
        type: "how_to_think",
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

    // 两段式调用：inspect/inspector.inspectCtx()
    const methods = registry.buildSandboxMethods(ctx, ["inspect/inspector"]);
    expect(methods["inspect/inspector"]).toBeDefined();
    const result = (await (methods["inspect/inspector"] as any).inspectCtx()) as Record<string, unknown>;
    expect(result.rootDir).toBe("/home/user/project");
    expect(result.selfDir).toBe("/home/user/project/stones/alice");
    expect(result.stoneName).toBe("alice");

    // 扁平调用同样可用
    expect(typeof methods.inspectCtx).toBe("function");
  });

  test("两段式方法调用 namespace/traitName.methodName()", async () => {
    const registry = new MethodRegistry();
    const traits: TraitDefinition[] = [
      {
        namespace: "math",
        name: "math_basic",
        type: "how_to_think",
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
        namespace: "str",
        name: "string_utils",
        type: "how_to_think",
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
    const methods = registry.buildSandboxMethods(ctx, ["math/math_basic", "str/string_utils"]);

    // 验证两段式调用：namespace/traitName.methodName()
    expect(methods["math/math_basic"]).toBeDefined();
    expect((methods["math/math_basic"] as any).add).toBeDefined();
    expect((methods["math/math_basic"] as any).subtract).toBeDefined();
    expect(methods["str/string_utils"]).toBeDefined();
    expect((methods["str/string_utils"] as any).concat).toBeDefined();

    // 验证两段式调用能正常工作
    const addResult = await (methods["math/math_basic"] as any).add(2, 3);
    expect(addResult).toBe(5);

    const subtractResult = await (methods["math/math_basic"] as any).subtract(10, 3);
    expect(subtractResult).toBe(7);

    const concatResult = await (methods["str/string_utils"] as any).concat("Hello, ", "World!");
    expect(concatResult).toBe("Hello, World!");

    // 扁平调用同样可用
    expect(typeof methods.add).toBe("function");
    expect(typeof methods.subtract).toBe("function");
    expect(typeof methods.concat).toBe("function");
  });

  test("buildSandboxMethods 按 activatedTraits 过滤方法", async () => {
    const registry = new MethodRegistry();
    const traits: TraitDefinition[] = [
      {
        namespace: "ns1",
        name: "trait_a",
        type: "how_to_think",
        when: "never",
        description: "",
        readme: "",
        methods: [
          { name: "methodA", description: "", params: [], fn: async () => "A" },
        ],
        deps: [],
      },
      {
        namespace: "ns2",
        name: "trait_b",
        type: "how_to_think",
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
    const methods = registry.buildSandboxMethods(ctx, ["ns1/trait_a"]);

    // trait_a 的方法应该可用（两段式调用）
    expect(methods["ns1/trait_a"]).toBeDefined();
    expect((methods["ns1/trait_a"] as any).methodA).toBeDefined();

    // trait_b 的方法应该不可用
    expect(methods["ns2/trait_b"]).toBeUndefined();

    // 扁平调用仅暴露已激活 trait 的方法
    expect(typeof methods.methodA).toBe("function");
    expect(methods.methodB).toBeUndefined();

    // 激活全部时所有 trait 都可用
    const allMethods = registry.buildSandboxMethods(ctx, ["ns1/trait_a", "ns2/trait_b"]);
    expect(allMethods["ns1/trait_a"]).toBeDefined();
    expect(allMethods["ns2/trait_b"]).toBeDefined();
  });
});
