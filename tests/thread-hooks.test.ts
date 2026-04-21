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
  collectCommandHooks,
} from "../src/thread/hooks.js";
import type { ThreadFrameHook } from "../src/thread/types.js";
import type { TraitDefinition } from "../src/types/index.js";

/**
 * 构造测试用 trait
 *
 * 接受完整 traitId（如 `kernel:verifiable`）；若不含冒号，默认为 library namespace。
 */
function makeTrait(traitIdLike: string, hooks?: { before?: string; after?: string }): TraitDefinition {
  const [nsOrName, rest] = traitIdLike.includes(":")
    ? traitIdLike.split(":", 2)
    : ["library", traitIdLike];
  const namespace = (rest ? nsOrName : "library") as TraitDefinition["namespace"];
  const name = rest ?? nsOrName;
  const t: TraitDefinition = {
    namespace,
    name,
    kind: "trait",
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
      makeTrait("kernel:verifiable", { before: "开始前，先明确验证标准。" }),
      makeTrait("kernel:computable"),
      makeTrait("library:academic_writing", { before: "请使用学术写作风格。" }),
    ];
    const scopeChain = ["kernel:verifiable", "kernel:computable", "library:academic_writing"];
    const firedHooks = new Set<string>();

    const result = collectBeforeHooks(traits, scopeChain, firedHooks);
    expect(result).not.toBeNull();
    expect(result).toContain("验证标准");
    expect(result).toContain("学术写作");
    expect(firedHooks.size).toBe(2);
  });

  test("once hook 不重复触发", () => {
    const traits = [
      makeTrait("kernel:verifiable", { before: "验证标准" }),
    ];
    const scopeChain = ["kernel:verifiable"];
    const firedHooks = new Set<string>(["kernel:verifiable:before"]);

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
      makeTrait("kernel:verifiable", { before: "验证标准" }),
    ];
    const result = collectBeforeHooks(traits, [], new Set());
    expect(result).toBeNull();
  });
});

describe("collectAfterHooks", () => {
  test("从 scope chain traits 收集 after hooks", () => {
    const traits = [
      makeTrait("kernel:reflective", { after: "子任务完成了，有什么值得沉淀的经验？" }),
    ];
    const scopeChain = ["kernel:reflective"];
    const firedHooks = new Set<string>();

    const result = collectAfterHooks(traits, scopeChain, firedHooks);
    expect(result).not.toBeNull();
    expect(result).toContain("经验");
    expect(firedHooks.has("kernel:reflective:after")).toBe(true);
  });

  test("合并 trait hooks 和 thread hooks", () => {
    const traits = [
      makeTrait("kernel:reflective", { after: "反思经验" }),
    ];
    const threadHooks: ThreadFrameHook[] = [
      { event: "after", traitName: "custom", content: "检查输出质量" },
    ];
    const scopeChain = ["kernel:reflective"];
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
      { namespace: "kernel", name: "talkable", commandBinding: { commands: ["talk", "talk_sync", "return"] } },
      { namespace: "kernel", name: "computable", commandBinding: { commands: ["program"] } },
      { namespace: "kernel", name: "base" }, // 无 commandBinding
    ] as any[];

    const result = collectCommandTraits(traits, new Set(["talk"]));
    expect(result).toContain("kernel:talkable");
    expect(result).not.toContain("kernel:computable");
  });

  test("空 activeCommands 返回空数组", () => {
    const traits = [
      { namespace: "kernel", name: "talkable", commandBinding: { commands: ["talk"] } },
    ] as any[];
    expect(collectCommandTraits(traits, new Set())).toEqual([]);
  });

  test("多指令匹配", () => {
    const traits = [
      { namespace: "kernel", name: "talkable", commandBinding: { commands: ["talk", "return"] } },
      { namespace: "kernel", name: "reflective", commandBinding: { commands: ["return"] } },
    ] as any[];

    const result = collectCommandTraits(traits, new Set(["return"]));
    expect(result).toContain("kernel:talkable");
    expect(result).toContain("kernel:reflective");
  });
});

describe("collectCommandHooks", () => {
  test("收集匹配 command 的 hooks", () => {
    const hooks: ThreadFrameHook[] = [
      { event: "on:return", traitName: "", content: "别忘了写总结报告", once: true },
      { event: "on:return", traitName: "", content: "记得 git commit", once: true },
      { event: "on:talk", traitName: "", content: "这条不应出现" },
    ];

    const result = collectCommandHooks("return", hooks);
    expect(result).not.toBeNull();
    expect(result).toContain("defer 提醒 — return");
    expect(result).toContain("别忘了写总结报告");
    expect(result).toContain("记得 git commit");
    expect(result).not.toContain("这条不应出现");
  });

  test("once=true 的 hook 触发后自动移除", () => {
    const hooks: ThreadFrameHook[] = [
      { event: "on:return", traitName: "", content: "一次性提醒", once: true },
      { event: "on:return", traitName: "", content: "持久提醒", once: false },
    ];

    const result1 = collectCommandHooks("return", hooks);
    expect(result1).toContain("一次性提醒");
    expect(result1).toContain("持久提醒");
    expect(hooks.length).toBe(1);
    expect(hooks[0].content).toBe("持久提醒");

    /* 第二次触发：只有持久提醒 */
    const result2 = collectCommandHooks("return", hooks);
    expect(result2).toContain("持久提醒");
    expect(result2).not.toContain("一次性提醒");
    expect(hooks.length).toBe(1);
  });

  test("默认 once=true（未指定 once 时）", () => {
    const hooks: ThreadFrameHook[] = [
      { event: "on:program", traitName: "", content: "默认一次性" },
    ];

    collectCommandHooks("program", hooks);
    expect(hooks.length).toBe(0);
  });

  test("无匹配 hook 时返回 null", () => {
    const hooks: ThreadFrameHook[] = [
      { event: "on:talk", traitName: "", content: "talk 提醒" },
    ];

    const result = collectCommandHooks("return", hooks);
    expect(result).toBeNull();
    expect(hooks.length).toBe(1); /* 未匹配的 hook 不被移除 */
  });

  test("hooks 为空数组时返回 null", () => {
    expect(collectCommandHooks("return", [])).toBeNull();
  });

  test("hooks 为 undefined 时返回 null", () => {
    expect(collectCommandHooks("return", undefined)).toBeNull();
  });

  test("不影响 before/after 类型的 hooks", () => {
    const hooks: ThreadFrameHook[] = [
      { event: "before", traitName: "test", content: "before hook" },
      { event: "after", traitName: "test", content: "after hook" },
      { event: "on:return", traitName: "", content: "defer hook" },
    ];

    const result = collectCommandHooks("return", hooks);
    expect(result).toContain("defer hook");
    expect(result).not.toContain("before hook");
    expect(result).not.toContain("after hook");
    /* before/after hooks 不被移除 */
    expect(hooks.length).toBe(2);
    expect(hooks[0].event).toBe("before");
    expect(hooks[1].event).toBe("after");
  });
});
