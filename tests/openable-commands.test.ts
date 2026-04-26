/**
 * getOpenableCommands() 动态生成枚举验证
 *
 * 验证：
 * 1. 返回值与预期集合完全一致（10 个，已排序）
 * 2. 不含 open/refine/submit/close/wait（不可 open 的工具原语）
 * 3. 不含 talk_sync（已折叠）
 * 4. OPEN_TOOL.command.enum 与 getOpenableCommands() 完全一致（动态生成）
 */
import { describe, test, expect } from "bun:test";
import { getOpenableCommands } from "../src/thread/command-table.js";
import { OPEN_TOOL } from "../src/thread/tools.js";

const EXPECTED_OPENABLE = [
  "await",
  "await_all",
  "call_function",
  "compact",
  "defer",
  "program",
  "return",
  "set_plan",
  "talk",
  "think",
];

describe("getOpenableCommands()", () => {
  test("返回 10 个命令", () => {
    expect(getOpenableCommands()).toHaveLength(10);
  });

  test("与预期集合完全一致（已排序）", () => {
    expect(getOpenableCommands()).toEqual(EXPECTED_OPENABLE);
  });

  test("不包含 talk_sync", () => {
    expect(getOpenableCommands()).not.toContain("talk_sync");
  });

  test("不包含 open/refine/submit/close/wait（工具原语，不是 command）", () => {
    const cmds = getOpenableCommands();
    for (const notOpenable of ["open", "refine", "submit", "close", "wait"]) {
      expect(cmds).not.toContain(notOpenable);
    }
  });

  test("包含所有预期的 openable command", () => {
    const cmds = getOpenableCommands();
    for (const cmd of EXPECTED_OPENABLE) {
      expect(cmds).toContain(cmd);
    }
  });
});

describe("OPEN_TOOL.command.enum 动态生成", () => {
  test("enum 与 getOpenableCommands() 完全一致", () => {
    const params = OPEN_TOOL.function.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, { enum?: string[] }>;
    const actualEnum = props.command?.enum ?? [];
    expect(actualEnum).toEqual(getOpenableCommands());
  });

  test("enum 不含 talk_sync", () => {
    const params = OPEN_TOOL.function.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, { enum?: string[] }>;
    const actualEnum = props.command?.enum ?? [];
    expect(actualEnum).not.toContain("talk_sync");
  });

  test("enum 包含 think 和 talk", () => {
    const params = OPEN_TOOL.function.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, { enum?: string[] }>;
    const actualEnum = props.command?.enum ?? [];
    expect(actualEnum).toContain("think");
    expect(actualEnum).toContain("talk");
  });
});
