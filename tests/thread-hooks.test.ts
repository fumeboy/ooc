/**
 * 线程 Hook 收集与注入测试
 *
 * 仅覆盖 command/defer hook。Trait 级 before/after hook 已随 TRAIT.md 的 hooks 字段
 * 一起下线，内容迁入 TRAIT.md 正文。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#7
 */
import { describe, test, expect } from "bun:test";
import {
  collectCommandTraits,
  collectCommandHooks,
} from "../src/thread/hooks.js";
import type { ThreadFrameHook } from "../src/thread/types.js";

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
