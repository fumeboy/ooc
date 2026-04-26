/**
 * 命令表基础单测
 *
 * 测试 deriveCommandPaths 从 (toolName, args) 派生多路径集合：
 * - 依照 COMMAND_TABLE 定义，match(args) 返回 string[]
 * - 各维度独立：wait / context / type 各自追加对应 path
 * - 父路径总是包含在结果中（bare command 名）
 */

import { describe, test, expect } from "bun:test";
import { deriveCommandPaths, COMMAND_TABLE, getOpenableCommands } from "../src/thread/command-table.js";

describe("deriveCommandPaths — 根层级", () => {
  test("未知 tool 名返回空数组", () => {
    expect(deriveCommandPaths("nope", {})).toEqual([]);
  });

  test("return 无参 → ['return']", () => {
    expect(deriveCommandPaths("return", { summary: "done" })).toEqual(["return"]);
  });

  test("program 无 language 时 → ['program']", () => {
    expect(deriveCommandPaths("program", {})).toEqual(["program"]);
  });

  test("program + language=shell → ['program', 'program.shell']", () => {
    expect(deriveCommandPaths("program", { language: "shell" })).toEqual(["program", "program.shell"]);
  });

  test("program + language=ts → ['program', 'program.ts']", () => {
    expect(deriveCommandPaths("program", { language: "ts" })).toEqual(["program", "program.ts"]);
  });
});

describe("deriveCommandPaths — talk 多路径并行", () => {
  test("talk 无参 → ['talk']", () => {
    expect(deriveCommandPaths("talk", {})).toEqual(["talk"]);
  });

  test("talk + context=fork → ['talk', 'talk.fork']", () => {
    expect(deriveCommandPaths("talk", { context: "fork" })).toEqual(["talk", "talk.fork"]);
  });

  test("talk + context=continue → ['talk', 'talk.continue']", () => {
    expect(deriveCommandPaths("talk", { context: "continue" })).toEqual(["talk", "talk.continue"]);
  });

  test("talk + context=continue + type=relation_update → 包含 talk, talk.continue, talk.relation_update, talk.continue.relation_update", () => {
    const paths = deriveCommandPaths("talk", { context: "continue", type: "relation_update" });
    expect(paths).toContain("talk");
    expect(paths).toContain("talk.continue");
    expect(paths).toContain("talk.relation_update");
    expect(paths).toContain("talk.continue.relation_update");
  });

  test("talk + context=continue + type=question_form → 包含 talk.continue.question_form", () => {
    const paths = deriveCommandPaths("talk", { context: "continue", type: "question_form" });
    expect(paths).toContain("talk");
    expect(paths).toContain("talk.continue");
    expect(paths).toContain("talk.question_form");
    expect(paths).toContain("talk.continue.question_form");
  });

  test("talk + context=continue + 未知 type → 仅 ['talk', 'talk.continue']", () => {
    expect(deriveCommandPaths("talk", { context: "continue", type: "unknown_x" })).toEqual(["talk", "talk.continue"]);
  });

  test("talk + context=fork + type=relation_update → ['talk', 'talk.fork', 'talk.relation_update']（无 fork.relation_update）", () => {
    const paths = deriveCommandPaths("talk", { context: "fork", type: "relation_update" });
    expect(paths).toContain("talk");
    expect(paths).toContain("talk.fork");
    expect(paths).toContain("talk.relation_update");
    expect(paths).not.toContain("talk.fork.relation_update");
    expect(paths).not.toContain("talk.continue.relation_update");
  });
});

describe("deriveCommandPaths — talk wait 维度独立", () => {
  test("talk(wait=true) → 包含 'talk' 和 'talk.wait'", () => {
    const paths = deriveCommandPaths("talk", { wait: true });
    expect(paths).toContain("talk");
    expect(paths).toContain("talk.wait");
  });

  test("talk(wait=true, context=fork) → 包含 talk, talk.wait, talk.fork（不含 talk.wait.fork）", () => {
    const paths = deriveCommandPaths("talk", { wait: true, context: "fork" });
    expect(paths).toContain("talk");
    expect(paths).toContain("talk.wait");
    expect(paths).toContain("talk.fork");
    /* 关键：无复合嵌套路径 talk.wait.fork */
    expect(paths).not.toContain("talk.wait.fork");
  });

  test("talk(wait=true, context=continue) → 包含 talk, talk.wait, talk.continue（不含 talk.wait.continue）", () => {
    const paths = deriveCommandPaths("talk", { wait: true, context: "continue" });
    expect(paths).toContain("talk");
    expect(paths).toContain("talk.wait");
    expect(paths).toContain("talk.continue");
    expect(paths).not.toContain("talk.wait.continue");
  });

  test("talk(wait=true, context=continue, type=relation_update) → 含四路径，无 talk.wait.continue.relation_update", () => {
    const paths = deriveCommandPaths("talk", { wait: true, context: "continue", type: "relation_update" });
    expect(paths).toContain("talk");
    expect(paths).toContain("talk.wait");
    expect(paths).toContain("talk.continue");
    expect(paths).toContain("talk.continue.relation_update");
    /* 关键：消除旧的复合嵌套 */
    expect(paths).not.toContain("talk.wait.continue");
    expect(paths).not.toContain("talk.wait.continue.relation_update");
    expect(paths).not.toContain("talk.wait.fork");
  });

  test("talk(wait=false) → 不含 talk.wait", () => {
    expect(deriveCommandPaths("talk", { wait: false, context: "fork" })).not.toContain("talk.wait");
  });

  test("talk(wait=undefined) → 不含 talk.wait", () => {
    expect(deriveCommandPaths("talk", { context: "fork" })).not.toContain("talk.wait");
  });
});

describe("deriveCommandPaths — think 多路径并行", () => {
  test("think 无参 → ['think']", () => {
    expect(deriveCommandPaths("think", {})).toEqual(["think"]);
  });

  test("think(context=fork) → ['think', 'think.fork']", () => {
    expect(deriveCommandPaths("think", { context: "fork" })).toEqual(["think", "think.fork"]);
  });

  test("think(context=continue) → ['think', 'think.continue']", () => {
    expect(deriveCommandPaths("think", { context: "continue" })).toEqual(["think", "think.continue"]);
  });

  test("think(wait=true) → 含 think.wait（不含 think.wait.fork）", () => {
    const paths = deriveCommandPaths("think", { wait: true });
    expect(paths).toContain("think");
    expect(paths).toContain("think.wait");
  });

  test("think(wait=true, context=fork) → think, think.wait, think.fork（不含 think.wait.fork）", () => {
    const paths = deriveCommandPaths("think", { wait: true, context: "fork" });
    expect(paths).toContain("think");
    expect(paths).toContain("think.wait");
    expect(paths).toContain("think.fork");
    expect(paths).not.toContain("think.wait.fork");
  });

  test("think(wait=true, context=continue) → think, think.wait, think.continue（不含 think.wait.continue）", () => {
    const paths = deriveCommandPaths("think", { wait: true, context: "continue" });
    expect(paths).toContain("think");
    expect(paths).toContain("think.wait");
    expect(paths).toContain("think.continue");
    expect(paths).not.toContain("think.wait.continue");
  });

  test("think(wait=false, context=fork) → 不含 think.wait", () => {
    expect(deriveCommandPaths("think", { wait: false, context: "fork" })).not.toContain("think.wait");
  });
});

describe("deriveCommandPaths — open 双分支（两路径并行）", () => {
  test("open + command=talk → ['open', 'open.command']", () => {
    expect(deriveCommandPaths("open", { command: "talk" })).toEqual(["open", "open.command"]);
  });

  test("open + path='/x' → ['open', 'open.path']", () => {
    expect(deriveCommandPaths("open", { path: "/x" })).toEqual(["open", "open.path"]);
  });

  test("open + command + path → ['open', 'open.command', 'open.path']（两维度并行）", () => {
    expect(deriveCommandPaths("open", { command: "talk", path: "/x" })).toEqual(["open", "open.command", "open.path"]);
  });

  test("open 无参 → ['open']", () => {
    expect(deriveCommandPaths("open", {})).toEqual(["open"]);
  });
});

describe("deriveCommandPaths — submit 多子", () => {
  test("submit 无 command → ['submit']", () => {
    expect(deriveCommandPaths("submit", {})).toEqual(["submit"]);
  });

  test("submit + command=compact → ['submit', 'submit.compact']", () => {
    expect(deriveCommandPaths("submit", { command: "compact" })).toEqual(["submit", "submit.compact"]);
  });

  test("submit + command=talk → ['submit', 'submit.talk']", () => {
    expect(deriveCommandPaths("submit", { command: "talk" })).toEqual(["submit", "submit.talk"]);
  });

  test("submit + command 无对应子节点 → ['submit']（保守）", () => {
    expect(deriveCommandPaths("submit", { command: "unknown_xyz" })).toEqual(["submit"]);
  });
});

describe("COMMAND_TABLE — 结构性检查", () => {
  test("顶层必须包含 spec 要求的 command", () => {
    const keys = Object.keys(COMMAND_TABLE);
    for (const c of ["talk", "open", "program", "submit", "return"]) {
      expect(keys).toContain(c);
    }
  });

  test("refine, close, wait 注册为顶层 entry", () => {
    expect(COMMAND_TABLE.refine).toBeDefined();
    expect(COMMAND_TABLE.close).toBeDefined();
    expect(COMMAND_TABLE.wait).toBeDefined();
  });

  test("每个 entry 都有 paths 和 match 字段", () => {
    for (const [key, entry] of Object.entries(COMMAND_TABLE)) {
      expect(Array.isArray(entry.paths), `${key}.paths should be array`).toBe(true);
      expect(typeof entry.match, `${key}.match should be function`).toBe("function");
    }
  });

  test("新增 openable 命令已注册：call_function, set_plan, await, await_all, defer, compact", () => {
    for (const cmd of ["call_function", "set_plan", "await", "await_all", "defer", "compact"]) {
      expect(COMMAND_TABLE[cmd]).toBeDefined();
      expect(COMMAND_TABLE[cmd]?.openable).toBe(true);
    }
  });
});

describe("COMMAND_TABLE.<entry>.paths declares known path universe", () => {
  test("talk paths 包含预期的所有路径（不含 talk.wait.fork 等复合嵌套）", () => {
    const entry = COMMAND_TABLE.talk!;
    expect(entry.paths).toContain("talk");
    expect(entry.paths).toContain("talk.continue");
    expect(entry.paths).toContain("talk.fork");
    expect(entry.paths).toContain("talk.wait");
    expect(entry.paths).toContain("talk.continue.relation_update");
    /* 旧复合路径已消除 */
    expect(entry.paths).not.toContain("talk.wait.fork");
    expect(entry.paths).not.toContain("talk.wait.continue");
    expect(entry.paths).not.toContain("talk.wait.continue.relation_update");
  });

  test("think paths 包含 think, think.fork, think.wait（不含 think.wait.fork）", () => {
    const entry = COMMAND_TABLE.think!;
    expect(entry.paths).toContain("think");
    expect(entry.paths).toContain("think.fork");
    expect(entry.paths).toContain("think.wait");
    expect(entry.paths).not.toContain("think.wait.fork");
    expect(entry.paths).not.toContain("think.wait.continue");
  });

  test("submit paths 包含 submit 及已知子路径", () => {
    const entry = COMMAND_TABLE.submit!;
    expect(entry.paths).toContain("submit");
    expect(entry.paths).toContain("submit.compact");
    expect(entry.paths).toContain("submit.talk");
  });
});

describe("getOpenableCommands()", () => {
  test("返回 10 个命令", () => {
    expect(getOpenableCommands()).toHaveLength(10);
  });

  test("getOpenableCommands 已包含所有 openable 命令", () => {
    const cmds = getOpenableCommands();
    for (const cmd of ["program", "think", "talk", "return", "call_function", "set_plan", "await", "await_all", "defer", "compact"]) {
      expect(cmds).toContain(cmd);
    }
  });

  test("不包含 open, refine, submit, close, wait（工具原语）", () => {
    const cmds = getOpenableCommands();
    for (const notOpenable of ["open", "refine", "submit", "close", "wait"]) {
      expect(cmds).not.toContain(notOpenable);
    }
  });
});
