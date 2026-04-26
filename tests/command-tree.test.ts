/**
 * 命令树基础单测（Phase 1）
 *
 * 测试 deriveCommandPath 从 (toolName, args) 推导命令路径：
 * - 依照 COMMAND_TREE 定义，沿途用 _match(args) 下潜
 * - 遇到 _match 返回 null/undefined / 节点无 _match 即停
 * - 多层深化：talk.continue.relation_update
 */

import { describe, test, expect } from "bun:test";
import { deriveCommandPath, COMMAND_TREE } from "../src/thread/command-tree.js";

describe("deriveCommandPath — 根层级", () => {
  test("未知 tool 名返回空串", () => {
    expect(deriveCommandPath("nope", {})).toBe("");
  });

  test("return 无 _match 停在根", () => {
    expect(deriveCommandPath("return", { summary: "done" })).toBe("return");
  });

  test("program 无 language 时停在 program", () => {
    expect(deriveCommandPath("program", {})).toBe("program");
  });

  test("program + language=shell → program.shell", () => {
    expect(deriveCommandPath("program", { language: "shell" })).toBe("program.shell");
  });

  test("program + language=ts → program.ts", () => {
    expect(deriveCommandPath("program", { language: "ts" })).toBe("program.ts");
  });
});

describe("deriveCommandPath — talk 三层", () => {
  test("talk 无 context → 停在 talk", () => {
    expect(deriveCommandPath("talk", {})).toBe("talk");
  });

  test("talk + context=fork → talk.fork", () => {
    expect(deriveCommandPath("talk", { context: "fork" })).toBe("talk.fork");
  });

  test("talk + context=continue (无 type) → talk.continue", () => {
    expect(deriveCommandPath("talk", { context: "continue" })).toBe("talk.continue");
  });

  test("talk + context=continue + type=relation_update → talk.continue.relation_update", () => {
    expect(
      deriveCommandPath("talk", { context: "continue", type: "relation_update" }),
    ).toBe("talk.continue.relation_update");
  });

  test("talk + context=continue + type=question_form → talk.continue.question_form", () => {
    expect(
      deriveCommandPath("talk", { context: "continue", type: "question_form" }),
    ).toBe("talk.continue.question_form");
  });

  test("talk + context=continue + 未知 type → 停在 talk.continue（未知子节点不下潜）", () => {
    expect(
      deriveCommandPath("talk", { context: "continue", type: "unknown_x" }),
    ).toBe("talk.continue");
  });

  test("talk + context=fork + type=relation_update → 停在 talk.fork（fork 层无 type 子节点）", () => {
    expect(
      deriveCommandPath("talk", { context: "fork", type: "relation_update" }),
    ).toBe("talk.fork");
  });
});

describe("deriveCommandPath — open 双分支", () => {
  test("open + command=talk → open.command", () => {
    expect(deriveCommandPath("open", { command: "talk" })).toBe("open.command");
  });

  test("open + path='/x' → open.path", () => {
    expect(deriveCommandPath("open", { path: "/x" })).toBe("open.path");
  });

  test("open + command 优先于 path（同时指定时以 command 为先）", () => {
    expect(deriveCommandPath("open", { command: "talk", path: "/x" })).toBe(
      "open.command",
    );
  });

  test("open 无参数停在 open", () => {
    expect(deriveCommandPath("open", {})).toBe("open");
  });
});

describe("deriveCommandPath — submit 多子", () => {
  test("submit 无 command → 停在 submit", () => {
    expect(deriveCommandPath("submit", {})).toBe("submit");
  });

  test("submit + command=compact → submit.compact", () => {
    expect(deriveCommandPath("submit", { command: "compact" })).toBe("submit.compact");
  });

  test("submit + command=talk → submit.talk", () => {
    expect(deriveCommandPath("submit", { command: "talk" })).toBe("submit.talk");
  });

  test("submit + command 无对应子节点 → 停在 submit（保守）", () => {
    expect(deriveCommandPath("submit", { command: "unknown_xyz" })).toBe("submit");
  });
});

describe("COMMAND_TREE — 结构性检查", () => {
  test("顶层必须包含 spec 要求的 command", () => {
    const keys = Object.keys(COMMAND_TREE);
    for (const c of ["talk", "open", "program", "submit", "return"]) {
      expect(keys).toContain(c);
    }
  });

  test("talk.continue 下必须包含 relation_update / question_form", () => {
    const cont = (COMMAND_TREE as any).talk.continue;
    expect(cont).toBeDefined();
    expect(cont.relation_update).toBeDefined();
    expect(cont.question_form).toBeDefined();
  });
});

describe("COMMAND_TREE.<root>.paths declares known path universe", () => {
  test("talk paths include talk, talk.continue, talk.fork", () => {
    const node = COMMAND_TREE.talk as { paths?: string[] };
    expect(node.paths).toBeDefined();
    expect(node.paths).toContain("talk");
    expect(node.paths).toContain("talk.continue");
    expect(node.paths).toContain("talk.fork");
  });

  test("submit paths include submit and known children", () => {
    const node = COMMAND_TREE.submit as { paths?: string[] };
    expect(node.paths).toBeDefined();
    expect(node.paths).toContain("submit");
  });

  test("refine, close, wait registered as top-level entries", () => {
    expect(COMMAND_TREE.refine).toBeDefined();
    expect(COMMAND_TREE.close).toBeDefined();
    expect(COMMAND_TREE.wait).toBeDefined();
  });
});
