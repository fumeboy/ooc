import { describe, it, expect } from "bun:test";
import { COMMAND_TABLE, getOpenableCommands, deriveCommandPaths } from "../commands/index";
import { programCommand } from "../commands/program";

describe("executable commands", () => {
  it("should have command table with all commands", () => {
    expect(Object.keys(COMMAND_TABLE)).toContain("talk");
    expect(Object.keys(COMMAND_TABLE)).toContain("do");
    expect(Object.keys(COMMAND_TABLE)).toContain("program");
    expect(Object.keys(COMMAND_TABLE)).toContain("plan");
    expect(Object.keys(COMMAND_TABLE)).toContain("todo");
    expect(Object.keys(COMMAND_TABLE)).toContain("end");
    expect(Object.keys(COMMAND_TABLE)).not.toContain("defer");
    expect(Object.keys(COMMAND_TABLE)).not.toContain("return");
    expect(Object.keys(COMMAND_TABLE)).not.toContain("compact");
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
    for (const entry of Object.values(COMMAND_TABLE)) {
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
    ]);
  });

  it("should expose non-empty knowledge entries for every command", () => {
    for (const [command, entry] of Object.entries(COMMAND_TABLE)) {
      const knowledge = entry.knowledge?.({}, "open");
      const basic = knowledge?.[`internal/executable/${command}/basic`];
      expect(typeof basic).toBe("string");
      expect(basic?.trim().length).toBeGreaterThan(20);
    }
  });

  it("root.talk paths in new model: only [talk] (say/wait/close moved to talk_window)", () => {
    expect(deriveCommandPaths("talk", { wait: true })).toEqual(["talk"]);
    expect(deriveCommandPaths("talk", { target: "user", title: "x" })).toEqual(["talk"]);
  });

  it("removed legacy talk paths (talk_window has its own command paths)", () => {
    // 旧 talk.fork / talk.continue / talk.thread_creator / talk.relation_update / talk.question_form
    // 在 Step 2 后已下线；talk_window 上的 say/say.wait/wait/close 走 windows registry
    const paths = deriveCommandPaths("talk", {
      context: "continue",
      target: "creator",
      type: "relation_update",
    });
    expect(paths).toEqual(["talk"]);
  });

  it("root.do paths in new model: only do and do.wait (continue moved to do_window)", () => {
    expect(deriveCommandPaths("do", { msg: "x" })).toEqual(["do"]);
    expect(deriveCommandPaths("do", { msg: "x", wait: true })).toEqual([
      "do",
      "do.wait",
    ]);
  });

  it("should keep program paths consistent with command docs", () => {
    expect(deriveCommandPaths("program", { language: "ts" })).toEqual([
      "program",
      "program.typescript"
    ]);
    expect(deriveCommandPaths("program", { language: "js" })).toEqual([
      "program",
      "program.javascript"
    ]);
    expect(deriveCommandPaths("program", { function: "readFile" })).toEqual([
      "program",
      "program.function"
    ]);
  });

  it("should return empty array for unknown command", () => {
    const paths = deriveCommandPaths("unknown", {});
    expect(paths).toEqual([]);
  });

  it("should derive todo reminder paths from args", () => {
    expect(deriveCommandPaths("todo", { content: "补测试" })).toEqual(["todo"]);
    expect(deriveCommandPaths("todo", { content: "补测试", on_command_path: ["program"] })).toEqual([
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
