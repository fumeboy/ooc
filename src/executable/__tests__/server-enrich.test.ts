import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, writeServerSource } from "../../persistable";
import { clearServerLoaderCache } from "../server/loader";
import { enrichProgramForm } from "../server/enrich";
import type { ActiveForm } from "../forms/form";
import type { ThreadContext } from "../../thinkable/context";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
  clearServerLoaderCache();
});

function makeForm(overrides: Partial<ActiveForm> = {}): ActiveForm {
  return {
    formId: "f_1",
    command: "program",
    description: "test",
    createdAt: 1,
    accumulatedArgs: {},
    commandPaths: ["program"],
    loadedKnowledgePaths: [],
    status: "open",
    ...overrides,
  };
}

describe("enrichProgramForm", () => {
  test("returns form unchanged when command is not program", async () => {
    const form = makeForm({ command: "plan" });
    const thread: ThreadContext = { id: "t", status: "running", events: [] };
    const result = await enrichProgramForm(form, thread);
    expect(result).toBe(form);
  });

  test("returns form unchanged when no function arg present", async () => {
    const form = makeForm({ accumulatedArgs: { language: "shell", code: "ls" } });
    const thread: ThreadContext = { id: "t", status: "running", events: [] };
    const result = await enrichProgramForm(form, thread);
    expect(result).toBe(form);
    expect(result.methodSchema).toBeUndefined();
  });

  test("returns form unchanged when thread has no persistence", async () => {
    const form = makeForm({ accumulatedArgs: { function: "add" } });
    const thread: ThreadContext = { id: "t", status: "running", events: [] };
    const result = await enrichProgramForm(form, thread);
    expect(result).toBe(form);
  });

  test("populates methodSchema when function matches a registered method", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-enrich-"));
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    await writeServerSource(
      stoneRef,
      `export const llm_methods = {
        add: {
          description: "两数相加",
          params: [
            { name: "a", type: "number", description: "第一个加数", required: true },
            { name: "b", type: "number", description: "第二个加数", required: true },
          ],
          fn: async (_ctx, { a, b }) => a + b,
        },
      };`
    );

    const form = makeForm({ accumulatedArgs: { function: "add" } });
    const thread: ThreadContext = {
      id: "t",
      status: "running",
      events: [],
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
    };

    const result = await enrichProgramForm(form, thread);
    expect(result).not.toBe(form);
    expect(result.methodSchema).toBeDefined();
    expect(result.methodSchema?.description).toBe("两数相加");
    expect(result.methodSchema?.params).toHaveLength(2);
    expect(result.methodSchema?.params?.[0]?.name).toBe("a");
    expect(result.methodSchema?.params?.[0]?.required).toBe(true);
  });

  test("returns form unchanged when function name does not match any registered method", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-enrich-"));
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    await writeServerSource(
      stoneRef,
      `export const llm_methods = { foo: { fn: async () => 1 } };`
    );

    const form = makeForm({ accumulatedArgs: { function: "bar" } });
    const thread: ThreadContext = {
      id: "t",
      status: "running",
      events: [],
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
    };

    const result = await enrichProgramForm(form, thread);
    expect(result).toBe(form);
    expect(result.methodSchema).toBeUndefined();
  });

  test("clears methodSchema when function arg is removed in subsequent refine", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-enrich-"));
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    await writeServerSource(
      stoneRef,
      `export const llm_methods = { add: { description: "test", fn: async () => 0 } };`
    );

    const thread: ThreadContext = {
      id: "t",
      status: "running",
      events: [],
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
    };

    const enriched = await enrichProgramForm(
      makeForm({ accumulatedArgs: { function: "add" } }),
      thread
    );
    expect(enriched.methodSchema).toBeDefined();

    // 用户后续 refine 把 function 改成空，应清掉 schema
    const cleared = await enrichProgramForm(
      { ...enriched, accumulatedArgs: { language: "shell", code: "ls" } },
      thread
    );
    expect(cleared.methodSchema).toBeUndefined();
  });
});
