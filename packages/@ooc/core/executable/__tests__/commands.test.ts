import { describe, it, expect } from "bun:test";
import { ROOT_METHODS, getOpenableMethods, deriveRootIntentPaths } from "@ooc/core/executable/manager.js";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import type { Intent } from "@ooc/core/_shared/types/intent.js";
import type { MethodExecuteForm } from "@ooc/core/_shared/types/method.js";

// 跑 bash 工具已从 root 移到 terminal 成员对象——经 registry 解析 terminal.run 测它。
const runMethod = builtinRegistry.resolveMethod("terminal", "run")!;

/**
 * Simulate onFormChange for a method and return the MethodExecuteForm.
 */
function callFormChange(
  cmd: { onFormChange?: (change: any, ctx: any) => MethodExecuteForm },
  args: Record<string, unknown>,
  status: "open" | "executing" | "success" | "failed",
): MethodExecuteForm {
  if (!cmd.onFormChange) return { intents: [] };
  const change =
    status !== "open"
      ? { kind: "status_changed" as const, to: status, from: "open" as const }
      : { kind: "args_refined" as const, args, added: [] as string[], removed: [] as string[], changed: [] as string[] };
  return cmd.onFormChange(change, { args });
}

describe("executable methods", () => {
  it("root type 只剩边缘 misc；agency/工具全部迁出（agent/成员对象）", () => {
    // root 残留：example（教学）+ feishu（extendable）
    expect(Object.keys(ROOT_METHODS)).toContain("example");
    // agency → _builtin/agent；file/run → filesystem/terminal/interpreter；create_object → runtime；
    // open_knowledge → knowledge_base —— 全部不在 root type。
    for (const moved of ["talk", "plan", "todo", "end", "grep", "run", "open_file", "create_object", "open_knowledge"]) {
      expect(Object.keys(ROOT_METHODS)).not.toContain(moved);
    }
    // 经各自归属解析得到：
    expect(builtinRegistry.resolveMethod("_builtin/agent", "talk")).toBeDefined();
    expect(builtinRegistry.resolveMethod("filesystem", "grep")).toBeDefined();
    expect(builtinRegistry.resolveMethod("terminal", "run")).toBeDefined();
    expect(builtinRegistry.resolveMethod("interpreter", "run")).toBeDefined();
    expect(builtinRegistry.resolveMethod("runtime", "create_object")).toBeDefined();
    expect(builtinRegistry.resolveMethod("knowledge_base", "open_knowledge")).toBeDefined();
  });

  it("should return sorted openable methods", () => {
    const openable = getOpenableMethods();
    expect(Array.isArray(openable)).toBe(true);
    expect(openable.length).toBeGreaterThan(0);
    expect(openable).toContain("talk");
    expect(openable).toContain("todo");
    expect(openable).not.toContain("run"); // 移到 terminal/interpreter 成员
    expect(openable).not.toContain("grep"); // 移到 filesystem 成员
    expect(openable).not.toContain("defer");
  });

  it("should define openable methods in index instead of each method file", () => {
    for (const entry of Object.values(ROOT_METHODS)) {
      expect("openable" in entry).toBe(false);
    }
    // getOpenableMethods = agent 经类链可达的 root-level 方法全集（agency + root misc）。
    // 工具方法在成员窗（grep/run → filesystem/terminal/interpreter；create_object → runtime；
    // open_knowledge → knowledge_base），不在此列。
    expect(getOpenableMethods()).toEqual([
      "end",
      "example",
      "open_feishu_chat",
      "open_feishu_doc",
      "plan",
      "talk",
      "todo",
    ]);
  });

  it("every root method has a description", () => {
    for (const [method, entry] of Object.entries(ROOT_METHODS)) {
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(5);
    }
  });

  it("root.talk static intents: [talk, talk.wait]（统一 peer + fork）", () => {
    const paths = deriveRootIntentPaths("talk", {});
    expect(paths).toEqual(expect.arrayContaining(["talk", "talk.wait"]));
  });

  it("terminal.run static intents include run.shell（run 已移到 terminal 成员）", () => {
    // run 不再是 root intent
    expect(deriveRootIntentPaths("run", {})).toEqual([]);
    // 粒度 intent 现属 terminal 成员的 run 方法
    expect(runMethod.intents).toContain("run.shell");
  });

  it("should return empty array for unknown method", () => {
    const paths = deriveRootIntentPaths("unknown", {});
    expect(paths).toEqual([]);
  });

  it("todo static intents include todo.activates_on", () => {
    const paths = deriveRootIntentPaths("todo", {});
    expect(paths).toContain("todo");
    expect(paths).toContain("todo.activates_on");
  });

  it("run onFormChange returns a tip string", () => {
    const form = callFormChange(runMethod, {}, "open");
    expect(typeof form.tip).toBe("string");
    expect(form.tip!.length).toBeGreaterThan(5);
    expect(Array.isArray(form.intents)).toBe(true);
  });

  it("run onFormChange returns quick_exec_submit when args are sufficient", () => {
    const form = callFormChange(runMethod, { code: "ls" }, "open");
    expect(form.quick_exec_submit).toBe(true);
  });
});
