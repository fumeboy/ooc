/**
 * 线程 Hook 收集与注入测试
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#7
 */
import { describe, test, expect } from "bun:test";
import {
  collectBeforeHooks,
  collectAfterHooks,
  collectCommandTraits,
} from "../src/thread/hooks.js";
import type { ThreadFrameHook } from "../src/thread/types.js";
import type { TraitDefinition } from "../src/types/index.js";

/** 构造测试用 trait */
function makeTrait(name: string, hooks?: { before?: string; after?: string }): TraitDefinition {
  const t: TraitDefinition = {
    name,
    type: "how_to_think",
    description: "",
    readme: "",
    when: "always",
    deps: [],
    methods: [],
  };
  if (hooks) {
    t.hooks = {};
    if (hooks.before) t.hooks.before = { inject: hooks.before, once: true };
    if (hooks.after) t.hooks.after = { inject: hooks.after, once: true };
  }
  return t;
}

describe("collectBeforeHooks", () => {
  test("从 scope chain traits 收集 before hooks", () => {
    const traits = [
      makeTrait("kernel/verifiable", { before: "开始前，先明确验证标准。" }),
      makeTrait("kernel/computable"),
      makeTrait("academic_writing", { before: "请使用学术写作风格。" }),
    ];
    const scopeChain = ["kernel/verifiable", "kernel/computable", "academic_writing"];
    const firedHooks = new Set<string>();

    const result = collectBeforeHooks(traits, scopeChain, firedHooks);
    expect(result).not.toBeNull();
    expect(result).toContain("验证标准");
    expect(result).toContain("学术写作");
    expect(firedHooks.size).toBe(2);
  });

  test("once hook 不重复触发", () => {
    const traits = [
      makeTrait("kernel/verifiable", { before: "验证标准" }),
    ];
    const scopeChain = ["kernel/verifiable"];
    const firedHooks = new Set<string>(["kernel/verifiable:before"]);

    const result = collectBeforeHooks(traits, scopeChain, firedHooks);
    expect(result).toBeNull();
  });

  test("从 ThreadFrameHook 收集 before hooks", () => {
    const threadHooks: ThreadFrameHook[] = [
      { event: "before", traitName: "custom", content: "自定义 before 提示", once: true },
      { event: "after", traitName: "custom", content: "这是 after，不应出现" },
    ];
    const firedHooks = new Set<string>();

    const result = collectBeforeHooks([], [], firedHooks, threadHooks);
    expect(result).not.toBeNull();
    expect(result).toContain("自定义 before 提示");
    expect(result).not.toContain("after");
  });

  test("scope chain 为空时返回 null", () => {
    const traits = [
      makeTrait("kernel/verifiable", { before: "验证标准" }),
    ];
    const result = collectBeforeHooks(traits, [], new Set());
    expect(result).toBeNull();
  });
});

describe("collectAfterHooks", () => {
  test("从 scope chain traits 收集 after hooks", () => {
    const traits = [
      makeTrait("kernel/reflective", { after: "子任务完成了，有什么值得沉淀的经验？" }),
    ];
    const scopeChain = ["kernel/reflective"];
    const firedHooks = new Set<string>();

    const result = collectAfterHooks(traits, scopeChain, firedHooks);
    expect(result).not.toBeNull();
    expect(result).toContain("经验");
    expect(firedHooks.has("kernel/reflective:after")).toBe(true);
  });

  test("合并 trait hooks 和 thread hooks", () => {
    const traits = [
      makeTrait("kernel/reflective", { after: "反思经验" }),
    ];
    const threadHooks: ThreadFrameHook[] = [
      { event: "after", traitName: "custom", content: "检查输出质量" },
    ];
    const scopeChain = ["kernel/reflective"];
    const firedHooks = new Set<string>();

    const result = collectAfterHooks(traits, scopeChain, firedHooks, threadHooks);
    expect(result).not.toBeNull();
    expect(result).toContain("反思经验");
    expect(result).toContain("检查输出质量");
  });
});

describe("collectCommandTraits", () => {
  test("匹配 commandBinding 中的指令", () => {
    const traits = [
      { name: "kernel/talkable", commandBinding: { commands: ["talk", "talk_sync", "return"] } },
      { name: "kernel/computable", commandBinding: { commands: ["program"] } },
      { name: "kernel/base" }, // 无 commandBinding
    ] as any[];

    const result = collectCommandTraits(traits, new Set(["talk"]));
    expect(result).toContain("kernel/talkable");
    expect(result).not.toContain("kernel/computable");
  });

  test("空 activeCommands 返回空数组", () => {
    const traits = [
      { name: "kernel/talkable", commandBinding: { commands: ["talk"] } },
    ] as any[];
    expect(collectCommandTraits(traits, new Set())).toEqual([]);
  });

  test("多指令匹配", () => {
    const traits = [
      { name: "kernel/talkable", commandBinding: { commands: ["talk", "return"] } },
      { name: "kernel/reflective", commandBinding: { commands: ["return"] } },
    ] as any[];

    const result = collectCommandTraits(traits, new Set(["return"]));
    expect(result).toContain("kernel/talkable");
    expect(result).toContain("kernel/reflective");
  });
});
