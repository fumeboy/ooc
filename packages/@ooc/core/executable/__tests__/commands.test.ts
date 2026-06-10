import { describe, it, expect } from "bun:test";
import { ROOT_METHODS, getOpenableMethods, deriveRootIntentPaths } from "../windows";
import { programMethod } from "@ooc/builtins/root/executable/method.program";
import type { Intent } from "@ooc/core/thinkable/context/intent.js";
import type { MethodExecuteForm } from "@ooc/core/_shared/types/method.js";

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
  it("should have method table with all methods", () => {
    expect(Object.keys(ROOT_METHODS)).toContain("talk");
    expect(Object.keys(ROOT_METHODS)).toContain("do");
    expect(Object.keys(ROOT_METHODS)).toContain("program");
    expect(Object.keys(ROOT_METHODS)).toContain("plan");
    expect(Object.keys(ROOT_METHODS)).toContain("todo");
    expect(Object.keys(ROOT_METHODS)).toContain("end");
    expect(Object.keys(ROOT_METHODS)).not.toContain("defer");
    expect(Object.keys(ROOT_METHODS)).not.toContain("return");
    expect(Object.keys(ROOT_METHODS)).not.toContain("compact");
  });

  it("should return sorted openable methods", () => {
    const openable = getOpenableMethods();
    expect(Array.isArray(openable)).toBe(true);
    expect(openable.length).toBeGreaterThan(0);
    expect(openable).toContain("talk");
    expect(openable).toContain("program");
    expect(openable).toContain("todo");
    expect(openable).not.toContain("defer");
  });

  it("should define openable methods in index instead of each method file", () => {
    for (const entry of Object.values(ROOT_METHODS)) {
      expect("openable" in entry).toBe(false);
    }
    expect(getOpenableMethods()).toEqual([
      "create_object",
      "do",
      "end",
      "evolve_self",
      "example",
      "glob",
      "grep",
      "open_feishu_chat",
      "open_feishu_doc",
      "open_file",
      "open_knowledge",
      "plan",
      "program",
      "talk",
      "todo",
      "write_file",
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

  it("program static intents include program.shell/typescript/javascript", () => {
    const paths = deriveRootIntentPaths("program", {});
    expect(paths).toContain("program");
    expect(paths).toContain("program.shell");
    expect(paths).toContain("program.typescript");
    expect(paths).toContain("program.javascript");
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
