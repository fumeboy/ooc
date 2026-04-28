/**
 * 命令表基础单测
 *
 * 测试 deriveCommandPaths 从 (command, args) 派生多路径集合：
 * - 依照 COMMAND_TABLE 定义，match(args) 返回 string[]
 * - 各维度独立：wait / context / type 各自追加对应 path
 * - 父路径总是包含在结果中（bare command 名）
 */

import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CompactCommandPath } from "../src/executable/commands/compact.js";
import { DeferCommandPath } from "../src/executable/commands/defer.js";
import { DoCommandPath } from "../src/executable/commands/do.js";
import { deriveCommandPaths, COMMAND_TABLE, getOpenableCommands } from "../src/executable/commands/index.js";
import { PlanCommandPath } from "../src/executable/commands/plan.js";
import { ProgramCommandPath } from "../src/executable/commands/program.js";
import { ReturnCommandPath } from "../src/executable/commands/return.js";
import { TalkCommandPath } from "../src/executable/commands/talk.js";

describe("deriveCommandPaths — 根层级", () => {
  test("single-path commands are declared through command path enums", () => {
    expect(COMMAND_TABLE.return!.paths).toEqual(Object.values(ReturnCommandPath));
    expect(COMMAND_TABLE.plan!.paths).toEqual(Object.values(PlanCommandPath));
    expect(COMMAND_TABLE.defer!.paths).toEqual(Object.values(DeferCommandPath));
    expect(COMMAND_TABLE.compact!.paths).toEqual(Object.values(CompactCommandPath));
  });

  test("未知 command 名返回空数组", () => {
    expect(deriveCommandPaths("nope", {})).toEqual([]);
  });

  test("return 无参 → ['return']", () => {
    expect(deriveCommandPaths("return", { summary: "done" })).toEqual(["return"]);
  });

  test("program 无 language 时 → ['program']", () => {
    expect(deriveCommandPaths("program", {})).toEqual(["program"]);
  });

  test("program command paths are declared through ProgramCommandPath enum", () => {
    expect(COMMAND_TABLE.program!.paths).toEqual(Object.values(ProgramCommandPath));
  });

  test("program + language=shell → ['program', 'program.shell']", () => {
    expect(deriveCommandPaths("program", { language: "shell" })).toEqual(["program", "program.shell"]);
  });

  test("program + language=ts → ['program', 'program.ts']", () => {
    expect(deriveCommandPaths("program", { language: "ts" })).toEqual(["program", "program.ts"]);
  });
});

describe("deriveCommandPaths — talk 多路径并行", () => {
  test("talk command paths are declared through TalkCommandPath enum", () => {
    expect(COMMAND_TABLE.talk!.paths).toEqual(Object.values(TalkCommandPath));
  });

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

describe("deriveCommandPaths — do 多路径并行", () => {
  test("do command paths are declared through DoCommandPath enum", () => {
    expect(COMMAND_TABLE.do!.paths).toEqual(Object.values(DoCommandPath));
  });

  test("do 无参 → ['do']", () => {
    expect(deriveCommandPaths("do", {})).toEqual(["do"] );
  });

  test("do(context=fork) → ['do', 'do.fork']", () => {
    expect(deriveCommandPaths("do", { context: "fork" })).toEqual(["do", "do.fork"]);
  });

  test("do(context=continue) → ['do', 'do.continue']", () => {
    expect(deriveCommandPaths("do", { context: "continue" })).toEqual(["do", "do.continue"]);
  });

  test("do(wait=true) → 含 do.wait（不含 do.wait.fork）", () => {
    const paths = deriveCommandPaths("do", { wait: true });
    expect(paths).toContain("do");
    expect(paths).toContain("do.wait");
  });

  test("do(wait=true, context=fork) → do, do.wait, do.fork（不含 do.wait.fork）", () => {
    const paths = deriveCommandPaths("do", { wait: true, context: "fork" });
    expect(paths).toContain("do");
    expect(paths).toContain("do.wait");
    expect(paths).toContain("do.fork");
    expect(paths).not.toContain("do.wait.fork");
  });

  test("do(wait=true, context=continue) → do, do.wait, do.continue（不含 do.wait.continue）", () => {
    const paths = deriveCommandPaths("do", { wait: true, context: "continue" });
    expect(paths).toContain("do");
    expect(paths).toContain("do.wait");
    expect(paths).toContain("do.continue");
    expect(paths).not.toContain("do.wait.continue");
  });

  test("do(wait=false, context=fork) → 不含 do.wait", () => {
    expect(deriveCommandPaths("do", { wait: false, context: "fork" })).not.toContain("do.wait");
  });
});

describe("deriveCommandPaths — 顶层 tool 不是 command", () => {
  test("open/refine/submit/close/wait 不在 command 路径表中派生路径", () => {
    for (const toolName of ["open", "refine", "submit", "close", "wait"]) {
      expect(deriveCommandPaths(toolName, { command: "talk" })).toEqual([]);
    }
  });
});

describe("COMMAND_TABLE — 结构性检查", () => {
  test("顶层必须包含 spec 要求的 command", () => {
    const keys = Object.keys(COMMAND_TABLE);
    for (const c of ["talk", "do", "program", "return", "plan", "defer", "compact"]) {
      expect(keys).toContain(c);
    }
  });

  test("顶层 tool 原语不注册为 command entry", () => {
    for (const toolName of ["open", "refine", "submit", "close", "wait"]) {
      expect(COMMAND_TABLE[toolName]).toBeUndefined();
    }
  });

  test("commands 目录不包含 tool-only 模块", () => {
    for (const toolName of ["open", "refine", "submit", "close", "wait"]) {
      expect(existsSync(join(import.meta.dir, "../src/executable/commands", `${toolName}.ts`))).toBe(false);
    }
  });

  test("每个 entry 都有 paths 和 match 字段", () => {
    for (const [key, entry] of Object.entries(COMMAND_TABLE)) {
      expect(Array.isArray(entry.paths), `${key}.paths should be array`).toBe(true);
      expect(typeof entry.match, `${key}.match should be function`).toBe("function");
    }
  });

  test("新增 openable 命令已注册：plan, defer, compact", () => {
    for (const cmd of ["plan", "defer", "compact"]) {
      expect(COMMAND_TABLE[cmd]).toBeDefined();
      expect(COMMAND_TABLE[cmd]?.openable).toBe(true);
    }
    expect(COMMAND_TABLE.await).toBeUndefined();
    expect(COMMAND_TABLE.await_all).toBeUndefined();
    expect(COMMAND_TABLE.call_function).toBeUndefined();
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

  test("do paths 包含 do, do.fork, do.wait（不含 do.wait.fork）", () => {
    const entry = COMMAND_TABLE.do!;
    expect(entry.paths).toContain("do");
    expect(entry.paths).toContain("do.fork");
    expect(entry.paths).toContain("do.wait");
    expect(entry.paths).not.toContain("do.wait.fork");
    expect(entry.paths).not.toContain("do.wait.continue");
  });

});

describe("getOpenableCommands()", () => {
  test("返回 7 个命令", () => {
    expect(getOpenableCommands()).toHaveLength(7);
  });

  test("getOpenableCommands 已包含所有 openable 命令", () => {
    const cmds = getOpenableCommands();
    for (const cmd of ["program", "do", "talk", "return", "plan", "defer", "compact"]) {
      expect(cmds).toContain(cmd);
    }
    expect(cmds).not.toContain("await");
    expect(cmds).not.toContain("await_all");
    expect(cmds).not.toContain("call_function");
  });

  test("不包含 open, refine, submit, close, wait（工具原语）", () => {
    const cmds = getOpenableCommands();
    for (const notOpenable of ["open", "refine", "submit", "close", "wait"]) {
      expect(cmds).not.toContain(notOpenable);
    }
  });
});
