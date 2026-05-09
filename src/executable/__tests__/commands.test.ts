import { describe, it, expect } from "bun:test";
import { COMMAND_TABLE, getOpenableCommands, deriveCommandPaths } from "../commands/index";
import { KNOWLEDGE as DO_KNOWLEDGE } from "../commands/do";
import { KNOWLEDGE as END_KNOWLEDGE } from "../commands/end";
import { KNOWLEDGE as PLAN_KNOWLEDGE } from "../commands/plan";
import { KNOWLEDGE as PROGRAM_KNOWLEDGE } from "../commands/program";
import { KNOWLEDGE as TALK_KNOWLEDGE } from "../commands/talk";
import { KNOWLEDGE as TODO_KNOWLEDGE } from "../commands/todo";

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
    expect(getOpenableCommands()).toEqual(["do", "end", "plan", "program", "talk", "todo"]);
  });

  it("should export non-empty KNOWLEDGE for every command", () => {
    const knowledges = [
      TALK_KNOWLEDGE,
      DO_KNOWLEDGE,
      PROGRAM_KNOWLEDGE,
      PLAN_KNOWLEDGE,
      TODO_KNOWLEDGE,
      END_KNOWLEDGE
    ];

    for (const knowledge of knowledges) {
      expect(typeof knowledge).toBe("string");
      expect(knowledge.trim().length).toBeGreaterThan(20);
      expect(knowledge).toContain("调用示例");
    }
  });

  it("should derive command paths from args", () => {
    const paths = deriveCommandPaths("talk", { wait: true });
    expect(Array.isArray(paths)).toBe(true);
    expect(paths).toContain("talk");
    expect(paths).toContain("talk.wait");
  });

  it("should keep talk paths consistent with command docs", () => {
    const relationPaths = deriveCommandPaths("talk", {
      context: "continue",
      target: "creator",
      type: "relation_update"
    });
    expect(relationPaths).toEqual([
      "talk",
      "talk.continue",
      "talk.thread_creator",
      "talk.relation_update"
    ]);

    const questionPaths = deriveCommandPaths("talk", { type: "question_form" });
    expect(questionPaths).toEqual(["talk", "talk.question_form"]);
  });

  it("should derive do continue and wait paths", () => {
    expect(deriveCommandPaths("do", { context: "continue" })).toEqual(["do", "do.continue"]);
    expect(deriveCommandPaths("do", { context: "fork", wait: true })).toEqual([
      "do",
      "do.fork",
      "do.wait"
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
});
