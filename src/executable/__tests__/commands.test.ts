import { describe, it, expect } from "bun:test";
import { ROOT_COMMANDS, getOpenableCommands, deriveRootCommandPaths } from "../windows";
import { programCommand } from "../windows/root/program";

describe("executable commands", () => {
  it("should have command table with all commands", () => {
    expect(Object.keys(ROOT_COMMANDS)).toContain("talk");
    expect(Object.keys(ROOT_COMMANDS)).toContain("do");
    expect(Object.keys(ROOT_COMMANDS)).toContain("program");
    expect(Object.keys(ROOT_COMMANDS)).toContain("plan");
    expect(Object.keys(ROOT_COMMANDS)).toContain("todo");
    expect(Object.keys(ROOT_COMMANDS)).toContain("end");
    expect(Object.keys(ROOT_COMMANDS)).not.toContain("defer");
    expect(Object.keys(ROOT_COMMANDS)).not.toContain("return");
    expect(Object.keys(ROOT_COMMANDS)).not.toContain("compact");
  });

  it("should return sorted openable commands", () => {
    const openable = getOpenableCommands();
    expect(Array.isArray(openable)).toBe(true);
    expect(openable.length).toBeGreaterThan(0);
    expect(openable).toContain("talk");
    expect(openable).toContain("program");
    expect(openable).toContain("todo");
    expect(openable).not.toContain("defer");
  });

  it("should define openable commands in index instead of each command file", () => {
    for (const entry of Object.values(ROOT_COMMANDS)) {
      expect("openable" in entry).toBe(false);
    }
    expect(getOpenableCommands()).toEqual([
      "do",
      "end",
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
    for (const [command, entry] of Object.entries(ROOT_COMMANDS)) {
      const knowledge = entry.knowledge?.({}, "open");
      const basic = knowledge?.[`internal/executable/${command}/basic`];
      expect(typeof basic).toBe("string");
      expect(basic?.trim().length).toBeGreaterThan(20);
    }
  });

  it("root.talk paths in new model: only [talk] (say/wait/close moved to talk_window)", () => {
    expect(deriveRootCommandPaths("talk", { wait: true })).toEqual(["talk"]);
    expect(deriveRootCommandPaths("talk", { target: "user", title: "x" })).toEqual(["talk"]);
  });

  it("removed legacy talk paths (talk_window has its own command paths)", () => {
    // 旧 talk.fork / talk.continue / talk.thread_creator / talk.relation_update / talk.question_form
    // 在 Step 2 后已下线；talk_window 上的 say/say.wait/wait/close 走 windows registry
    const paths = deriveRootCommandPaths("talk", {
      context: "continue",
      target: "creator",
      type: "relation_update",
    });
    expect(paths).toEqual(["talk"]);
  });

  it("root.do paths in new model: only do and do.wait (continue moved to do_window)", () => {
    expect(deriveRootCommandPaths("do", { msg: "x" })).toEqual(["do"]);
    expect(deriveRootCommandPaths("do", { msg: "x", wait: true })).toEqual([
      "do",
      "do.wait",
    ]);
  });

  it("should keep program paths consistent with command docs", () => {
    expect(deriveRootCommandPaths("program", { language: "ts" })).toEqual([
      "program",
      "program.typescript"
    ]);
    expect(deriveRootCommandPaths("program", { language: "js" })).toEqual([
      "program",
      "program.javascript"
    ]);
    expect(deriveRootCommandPaths("program", { function: "readFile" })).toEqual([
      "program",
      "program.function"
    ]);
  });

  it("should return empty array for unknown command", () => {
    const paths = deriveRootCommandPaths("unknown", {});
    expect(paths).toEqual([]);
  });

  it("should derive todo reminder paths from args", () => {
    expect(deriveRootCommandPaths("todo", { content: "补测试" })).toEqual(["todo"]);
    expect(deriveRootCommandPaths("todo", { content: "补测试", on_command_path: ["program"] })).toEqual([
      "todo",
      "todo.on_command_path"
    ]);
  });

  it("should expose dynamic program knowledge entries", () => {
    expect(programCommand.knowledge?.({}, "open")).toEqual(
      expect.objectContaining({
        "internal/executable/program/basic": expect.any(String),
        "internal/executable/program/input": expect.any(String),
      })
    );
    expect(
      programCommand.knowledge?.({ language: "shell", code: "ls" }, "executing")?.["internal/executable/program/form-status"]
    ).toContain("executing 状态的 form");
  });

  it("should describe program executing and executed knowledge without relying on inline form wording", () => {
    expect(
      programCommand.knowledge?.({ language: "shell", code: "ls" }, "executing")?.["internal/executable/program/form-status"]
    ).toContain("对于 command program 的 executing 状态的 form");
    expect(
      programCommand.knowledge?.({ function: "readFile", args: { path: "a" } }, "executed")?.["internal/executable/program/form-status"]
    ).toContain("对于 command program 的 executed 状态的 form");
  });
});
