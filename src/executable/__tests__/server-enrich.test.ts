import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, writeServerSource } from "../../persistable";
import { clearServerLoaderCache } from "../server/loader";
import { enrichProgramFormCommand } from "../server/enrich";
import type { CommandExecWindow } from "../windows/_shared/types";
import { customWindowIdOf } from "../windows/_shared/types";
import { makeThread } from "../../__tests__/make-thread";
// 触发 custom dispatcher 注册
import "../windows/custom/index";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
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

function makeThreadWithStone(tempRoot: string) {
  const thread = makeThread({
    id: "t",
    persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
  });
  // custom window 单例（plan §6.4 实际由 initContextWindows 注入；这里手工补）
  thread.contextWindows.push({
    id: customWindowIdOf("agent"),
    type: "custom",
    title: "agent",
    status: "open",
    createdAt: Date.now(),
    objectId: "agent",
  });
  return thread;
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

  test("returns form unchanged-shape when no callCommand args present", async () => {
    const form = makeForm({ accumulatedArgs: { language: "shell", code: "ls" } });
    const thread = makeThread({ id: "t" });
    const result = await enrichProgramFormCommand(form, thread);
    expect(result.commandKnowledgePaths).toEqual([
      "internal/executable/program/basic",
      "internal/executable/program/input",
    ]);
  });

  test("adds program callCommand knowledge path when command exists on a custom window", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-enrich-"));
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    await writeServerSource(
      stoneRef,
      `export const window = {
        commands: {
          add: {
            paths: ["add"],
            match: () => ["add"],
            knowledge: () => ({ "internal/windows/custom/add/basic": "两数相加" }),
            exec: async ({ args }) => ({ ok: true, result: String(Number(args.a) + Number(args.b)) }),
          },
        },
      };
      export const ui_methods = {};`,
    );

    const customId = customWindowIdOf("agent");
    const form = makeForm({
      accumulatedArgs: { window_id: customId, command: "add" },
    });
    const result = await enrichProgramFormCommand(form, makeThreadWithStone(tempRoot));

    expect(result).not.toBe(form);
    expect(result.commandKnowledgePaths).toContain("internal/executable/program/callCommand");
  });

  test("keeps generic program knowledge when callCommand target is unknown", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-enrich-"));
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    await writeServerSource(
      stoneRef,
      `export const window = { commands: { foo: { paths: ["foo"], match: () => ["foo"], exec: async () => ({ ok: true }) } } }; export const ui_methods = {};`,
    );

    const form = makeForm({
      accumulatedArgs: { window_id: customWindowIdOf("agent"), command: "bar" },
    });
    const result = await enrichProgramFormCommand(form, makeThreadWithStone(tempRoot));
    expect(result.commandKnowledgePaths).toEqual([
      "internal/executable/program/basic",
      "internal/executable/program/input",
    ]);
  });

  test("clears callCommand-specific knowledge when callCommand args are removed in subsequent refine", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-enrich-"));
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    await writeServerSource(
      stoneRef,
      `export const window = {
        commands: {
          add: {
            paths: ["add"],
            match: () => ["add"],
            knowledge: () => ({ "internal/windows/custom/add/basic": "test" }),
            exec: async () => ({ ok: true }),
          },
        },
      };
      export const ui_methods = {};`,
    );

    const enriched = await enrichProgramFormCommand(
      makeForm({ accumulatedArgs: { window_id: customWindowIdOf("agent"), command: "add" } }),
      makeThreadWithStone(tempRoot),
    );
    expect(enriched.commandKnowledgePaths).toContain("internal/executable/program/callCommand");

    const cleared = await enrichProgramFormCommand(
      { ...enriched, accumulatedArgs: { language: "shell", code: "ls" } },
      makeThreadWithStone(tempRoot),
    );
    expect(cleared.commandKnowledgePaths).not.toContain("internal/executable/program/callCommand");
    expect(cleared.commandKnowledgePaths).toContain("internal/executable/program/input");
  });
});
