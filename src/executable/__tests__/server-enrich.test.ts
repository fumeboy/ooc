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

function makeThreadWithStone(tempRoot: string): ThreadContext {
  return {
    id: "t",
    status: "running",
    events: [],
    persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
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
    expect(result.methodKnowledge).toBeUndefined();
  });

  test("returns form unchanged when thread has no persistence", async () => {
    const form = makeForm({ accumulatedArgs: { function: "add" } });
    const thread: ThreadContext = { id: "t", status: "running", events: [] };
    const result = await enrichProgramForm(form, thread);
    expect(result).toBe(form);
  });

  test("falls back to default knowledge from description+params when method has no knowledge fn", async () => {
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
    const result = await enrichProgramForm(form, makeThreadWithStone(tempRoot));

    expect(result).not.toBe(form);
    expect(result.methodKnowledge).toContain("两数相加");
    expect(result.methodKnowledge).toContain("- a [number]（必填）：第一个加数");
    expect(result.methodKnowledge).toContain("- b [number]（必填）：第二个加数");
  });

  test("uses custom knowledge fn when method provides one", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-enrich-"));
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    // knowledge 函数据 args.mode 动态返回不同文本
    await writeServerSource(
      stoneRef,
      `export const llm_methods = {
        deploy: {
          description: "部署服务",
          knowledge: (args) => {
            if (args.mode === "prod") {
              return "生产环境部署：必须先经过 review，且需带 release_notes 字段。";
            }
            return "开发环境部署：直接传 service_name 即可，不需要 review。";
          },
          fn: async () => "deployed",
        },
      };`
    );

    const formDev = makeForm({ accumulatedArgs: { function: "deploy", args: { mode: "dev" } } });
    const dev = await enrichProgramForm(formDev, makeThreadWithStone(tempRoot));
    expect(dev.methodKnowledge).toContain("开发环境");
    expect(dev.methodKnowledge).not.toContain("生产环境");

    const formProd = makeForm({ accumulatedArgs: { function: "deploy", args: { mode: "prod" } } });
    const prod = await enrichProgramForm(formProd, makeThreadWithStone(tempRoot));
    expect(prod.methodKnowledge).toContain("生产环境");
    expect(prod.methodKnowledge).toContain("release_notes");
  });

  test("falls back to default when custom knowledge fn throws", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-enrich-"));
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    await writeServerSource(
      stoneRef,
      `export const llm_methods = {
        boom: {
          description: "总是炸",
          knowledge: () => { throw new Error("intentional"); },
          fn: async () => null,
        },
      };`
    );

    const form = makeForm({ accumulatedArgs: { function: "boom" } });
    const result = await enrichProgramForm(form, makeThreadWithStone(tempRoot));
    expect(result.methodKnowledge).toContain("总是炸");
  });

  test("returns form unchanged when function name does not match any registered method", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-enrich-"));
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    await writeServerSource(
      stoneRef,
      `export const llm_methods = { foo: { fn: async () => 1 } };`
    );

    const form = makeForm({ accumulatedArgs: { function: "bar" } });
    const result = await enrichProgramForm(form, makeThreadWithStone(tempRoot));
    expect(result).toBe(form);
    expect(result.methodKnowledge).toBeUndefined();
  });

  test("clears methodKnowledge when function arg is removed in subsequent refine", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-enrich-"));
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    await writeServerSource(
      stoneRef,
      `export const llm_methods = { add: { description: "test", fn: async () => 0 } };`
    );

    const enriched = await enrichProgramForm(
      makeForm({ accumulatedArgs: { function: "add" } }),
      makeThreadWithStone(tempRoot)
    );
    expect(enriched.methodKnowledge).toBeDefined();

    const cleared = await enrichProgramForm(
      { ...enriched, accumulatedArgs: { language: "shell", code: "ls" } },
      makeThreadWithStone(tempRoot)
    );
    expect(cleared.methodKnowledge).toBeUndefined();
  });
});
