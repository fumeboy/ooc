import { describe, it, expect } from "bun:test";
import { ROOT_METHODS, getOpenableMethods, deriveRootMethodPaths } from "../windows";
import { programCommand } from "@ooc/builtins/root/executable/method.program";
import type { Intent } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";

/**
 * Simulate the old `knowledge(args, status)` API using the new `onFormChange` interface.
 * Returns the same Record<path, content> shape for test backward compatibility.
 */
function callKnowledge(
  cmd: { onFormChange?: unknown; intent?: (args: Record<string, unknown>) => Intent[] },
  args: Record<string, unknown>,
  status: "open" | "executing" | "success" | "failed",
): Record<string, string> {
  const fn = cmd.onFormChange as
    | ((
        change: any,
        ctx: { form: MethodExecWindow; intents: Intent[] },
      ) => ContextWindow[])
    | undefined;
  if (!fn) return {};
  const form: MethodExecWindow = {
    id: "test_form",
    type: "method_exec",
    parentWindowId: "root",
    title: "test",
    command: "test",
    description: "",
    accumulatedArgs: args,
    commandPaths: [],
    loadedKnowledgePaths: [],
    status,
    createdAt: 0,
  };
  const intents = cmd.intent?.(args) ?? [];
  const change =
    status !== "open"
      ? { kind: "status_changed" as const, to: status, from: "open" as const }
      : { kind: "args_refined" as const, args, added: [] as string[], removed: [] as string[], changed: [] as string[] };
  const windows = fn(change, { form, intents });
  const out: Record<string, string> = {};
  for (const w of windows) {
    out[w.title] = (w as any).content ?? "";
  }
  return out;
}

describe("executable commands", () => {
  it("should have command table with all commands", () => {
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

  it("should return sorted openable commands", () => {
    const openable = getOpenableMethods();
    expect(Array.isArray(openable)).toBe(true);
    expect(openable.length).toBeGreaterThan(0);
    expect(openable).toContain("talk");
    expect(openable).toContain("program");
    expect(openable).toContain("todo");
    expect(openable).not.toContain("defer");
  });

  it("should define openable commands in index instead of each command file", () => {
    for (const entry of Object.values(ROOT_METHODS)) {
      expect("openable" in entry).toBe(false);
    }
    expect(getOpenableMethods()).toEqual([
      "do",
      "end",
      "glob",
      "grep",
      "metaprog",
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

  it("should expose non-empty knowledge entries for every command", () => {
    for (const [command, entry] of Object.entries(ROOT_METHODS)) {
      const knowledge = callKnowledge(entry, {}, "open");
      const basic = knowledge[`internal/executable/${command}/basic`];
      expect(typeof basic).toBe("string");
      expect(basic?.trim().length).toBeGreaterThan(20);
    }
  });

  it("root.talk paths in new model: only [talk] (say/wait/close moved to talk_window)", () => {
    expect(deriveRootMethodPaths("talk", { wait: true })).toEqual(["talk"]);
    expect(deriveRootMethodPaths("talk", { target: "user", title: "x" })).toEqual(["talk"]);
  });

  it("removed legacy talk paths (talk_window has its own command paths)", () => {
    // 旧 talk.fork / talk.continue / talk.thread_creator / talk.relation_update / talk.question_form
    // 在 Step 2 后已下线；talk_window 上的 say/say.wait/wait/close 走 windows registry
    const paths = deriveRootMethodPaths("talk", {
      context: "continue",
      target: "creator",
      type: "relation_update",
    });
    expect(paths).toEqual(["talk"]);
  });

  it("root.do paths in new model: only do and do.wait (continue moved to do_window)", () => {
    expect(deriveRootMethodPaths("do", { msg: "x" })).toEqual(["do"]);
    expect(deriveRootMethodPaths("do", { msg: "x", wait: true })).toEqual([
      "do",
      "do.wait",
    ]);
  });

  it("should keep program paths consistent with command docs", () => {
    expect(deriveRootMethodPaths("program", { language: "ts" })).toEqual([
      "program",
      "program.typescript"
    ]);
    expect(deriveRootMethodPaths("program", { language: "js" })).toEqual([
      "program",
      "program.javascript"
    ]);
  });

  it("should return empty array for unknown command", () => {
    const paths = deriveRootMethodPaths("unknown", {});
    expect(paths).toEqual([]);
  });

  it("should derive todo reminder paths from args", () => {
    expect(deriveRootMethodPaths("todo", { content: "补测试" })).toEqual(["todo"]);
    expect(deriveRootMethodPaths("todo", { content: "补测试", on_command_path: ["program"] })).toEqual([
      "todo",
      "todo.on_command_path"
    ]);
  });

  it("should expose dynamic program knowledge entries", () => {
    expect(callKnowledge(programCommand, {}, "open")).toEqual(
      expect.objectContaining({
        "internal/executable/program/basic": expect.any(String),
        "internal/executable/program/input": expect.any(String),
      })
    );
    expect(
      callKnowledge(programCommand, { language: "shell", code: "ls" }, "executing")["internal/executable/program/form-status"]
    ).toContain("executing 状态的 form");
  });

  it("should describe program executing and failed knowledge without relying on inline form wording (Round 13)", () => {
    expect(
      callKnowledge(programCommand, { language: "shell", code: "ls" }, "executing")["internal/executable/program/form-status"]
    ).toContain("对于 command program 的 executing 状态的 form");
    expect(
      callKnowledge(programCommand, { function: "readFile", args: { path: "a" } }, "failed")["internal/executable/program/form-status"]
    ).toContain("对于 command program 的 failed 状态的 form");
  });
});
