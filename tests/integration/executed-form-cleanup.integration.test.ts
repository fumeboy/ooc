import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: executed-form-cleanup", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent runs ls, reads result, closes form, then ends", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请用 shell 跑 'ls src/'，看到结果后立刻 close 那个已 executed 的 form 释放 context。",
        "然后 end。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 10 });

    expect(root.status).toBe("done");
    expect(countEventsWithPrefix(root, "[form executed]")).toBeGreaterThanOrEqual(1);
    expect(countEventsWithPrefix(root, "[close]")).toBeGreaterThanOrEqual(1);

    const programForms = (root.activeForms ?? []).filter((f) => f.command === "program");
    expect(programForms.length).toBe(0);
  }, 120_000);
});
