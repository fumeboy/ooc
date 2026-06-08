import { afterEach, describe, expect, test } from "bun:test";
import { clearServerLoaderCache } from "@ooc/core/runtime/server-loader";
import { enrichFormMethodKnowledge } from "@ooc/core/thinkable/knowledge/index";
import type { MethodExecWindow } from "../windows/_shared/types";
import { makeThread } from "../../__tests__/make-thread";

afterEach(() => {
  clearServerLoaderCache();
});

function makeForm(overrides: Partial<MethodExecWindow> = {}): MethodExecWindow {
  return {
    id: "f_1",
    type: "method_exec",
    parentWindowId: "root",
    title: "test",
    status: "open",
    createdAt: 1,
    method: "program",
    description: "test",
    accumulatedArgs: {},
    methodPaths: ["program"],
    loadedKnowledgePaths: [],
    ...overrides,
  };
}

describe("enrichFormMethodKnowledge", () => {
  test("enriches command knowledge paths even when command is not program", async () => {
    const form = makeForm({ method: "plan" });
    const thread = makeThread({ id: "t" });
    const result = await enrichFormMethodKnowledge(form, thread);
    expect(result).not.toBe(form);
    expect(result.methodKnowledgePaths).toEqual([
      "internal/executable/plan/basic",
      "internal/executable/plan/input",
    ]);
  });

  test("returns generic program knowledge for shell+code form", async () => {
    const form = makeForm({ accumulatedArgs: { language: "shell", code: "ls" } });
    const thread = makeThread({ id: "t" });
    const result = await enrichFormMethodKnowledge(form, thread);
    expect(result.methodKnowledgePaths).toEqual([
      "internal/executable/program/basic",
      "internal/executable/program/input",
    ]);
  });

  test("returns generic program knowledge when args are empty", async () => {
    const form = makeForm({ accumulatedArgs: {} });
    const thread = makeThread({ id: "t" });
    const result = await enrichFormMethodKnowledge(form, thread);
    expect(result.methodKnowledgePaths).toEqual([
      "internal/executable/program/basic",
      "internal/executable/program/input",
    ]);
  });
});
