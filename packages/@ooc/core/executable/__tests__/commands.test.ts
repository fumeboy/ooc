import { describe, it, expect } from "bun:test";
import { ROOT_METHODS, getOpenableMethods, deriveRootIntentPaths } from "../windows";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import type { Intent } from "@ooc/core/_shared/types/intent.js";
import type { MethodExecuteForm } from "@ooc/core/_shared/types/method.js";

// program 工具已从 root 移到 terminal 成员对象——经 registry 解析 terminal.program 测它。
const programMethod = builtinRegistry.resolveMethod("terminal", "program")!;

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
  it("should have method table with agency + misc methods (file/program tools moved to members)", () => {
    expect(Object.keys(ROOT_METHODS)).toContain("talk");
    expect(Object.keys(ROOT_METHODS)).toContain("do");
    expect(Object.keys(ROOT_METHODS)).toContain("plan");
    expect(Object.keys(ROOT_METHODS)).toContain("todo");
    expect(Object.keys(ROOT_METHODS)).toContain("end");
    // 文件/程序工具已移出 root → filesystem/terminal 成员对象（消除 god-object 冗余）。
    expect(Object.keys(ROOT_METHODS)).not.toContain("program");
    expect(Object.keys(ROOT_METHODS)).not.toContain("grep");
    expect(Object.keys(ROOT_METHODS)).not.toContain("open_file");
    expect(Object.keys(ROOT_METHODS)).not.toContain("defer");
  });

  it("should return sorted openable methods", () => {
    const openable = getOpenableMethods();
    expect(Array.isArray(openable)).toBe(true);
    expect(openable.length).toBeGreaterThan(0);
    expect(openable).toContain("talk");
    expect(openable).toContain("todo");
    expect(openable).not.toContain("program"); // 移到 terminal 成员
    expect(openable).not.toContain("grep"); // 移到 filesystem 成员
    expect(openable).not.toContain("defer");
  });

  it("should define openable methods in index instead of each method file", () => {
    for (const entry of Object.values(ROOT_METHODS)) {
      expect("openable" in entry).toBe(false);
    }
    // 文件/程序工具（grep/glob/open_file/write_file/program）移出 root → filesystem/terminal 成员。
    // new_feat_branch / create_pr_and_invite_reviewers 挂 reflect_request window（reflectable）。
    expect(getOpenableMethods()).toEqual([
      "create_object",
      "do",
      "end",
      "example",
      "open_feishu_chat",
      "open_feishu_doc",
      "open_knowledge",
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

  it("root.talk static intents: includes talk", () => {
    const paths = deriveRootIntentPaths("talk", {});
    expect(paths).toContain("talk");
  });

  it("root.do static intents: [do, do.wait]", () => {
    expect(deriveRootIntentPaths("do", {})).toEqual(expect.arrayContaining(["do", "do.wait"]));
  });

  it("terminal.program static intents include program.shell/typescript/javascript（program 已移到 terminal 成员）", () => {
    // program 不再是 root intent
    expect(deriveRootIntentPaths("program", {})).toEqual([]);
    // 粒度 intent 现属 terminal 成员的 program 方法
    expect(programMethod.intents).toContain("program.shell");
    expect(programMethod.intents).toContain("program.typescript");
    expect(programMethod.intents).toContain("program.javascript");
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

  it("program onFormChange returns a tip string", () => {
    const form = callFormChange(programMethod, {}, "open");
    expect(typeof form.tip).toBe("string");
    expect(form.tip!.length).toBeGreaterThan(5);
    expect(Array.isArray(form.intents)).toBe(true);
  });

  it("program onFormChange returns quick_exec_submit when args are sufficient", () => {
    const form = callFormChange(programMethod, { language: "shell", code: "ls" }, "open");
    expect(form.quick_exec_submit).toBe(true);
  });
});
