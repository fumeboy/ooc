import { afterEach, describe, expect, test } from "bun:test";
import { clearServerLoaderCache } from "../server/loader";
import { enrichProgramFormCommand } from "../server/enrich";
import type { CommandExecWindow } from "../windows/_shared/types";
import { makeThread } from "../../__tests__/make-thread";
// 触发 custom dispatcher 注册
import "../windows/custom/index";

afterEach(() => {
  clearServerLoaderCache();
});

function makeForm(overrides: Partial<CommandExecWindow> = {}): CommandExecWindow {
  return {
    id: "f_1",
    type: "command_exec",
    parentWindowId: "root",
    title: "test",
    status: "open",
    createdAt: 1,
    command: "program",
    description: "test",
    accumulatedArgs: {},
    commandPaths: ["program"],
    loadedKnowledgePaths: [],
    ...overrides,
  };
}

describe("enrichProgramFormCommand", () => {
  test("enriches command knowledge paths even when command is not program", async () => {
    const form = makeForm({ command: "plan" });
    const thread = makeThread({ id: "t" });
    const result = await enrichProgramFormCommand(form, thread);
    expect(result).not.toBe(form);
    expect(result.commandKnowledgePaths).toEqual([
      "internal/executable/plan/basic",
      "internal/executable/plan/input",
    ]);
  });

  test("returns generic program knowledge for shell+code form", async () => {
    const form = makeForm({ accumulatedArgs: { language: "shell", code: "ls" } });
    const thread = makeThread({ id: "t" });
    const result = await enrichProgramFormCommand(form, thread);
    expect(result.commandKnowledgePaths).toEqual([
      "internal/executable/program/basic",
      "internal/executable/program/input",
    ]);
  });

  test("returns generic program knowledge when args are empty", async () => {
    const form = makeForm({ accumulatedArgs: {} });
    const thread = makeThread({ id: "t" });
    const result = await enrichProgramFormCommand(form, thread);
    expect(result.commandKnowledgePaths).toEqual([
      "internal/executable/program/basic",
      "internal/executable/program/input",
    ]);
  });
});
