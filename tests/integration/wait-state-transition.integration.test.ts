import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: wait-state-transition", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent enters waiting state via wait tool", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请直接调用 wait tool，reason='等待用户输入'。",
        "不要做其它事，不要 open 任何 form，不要 end。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 5 });

    expect(root.status).toBe("waiting");
    expect(root.waitingType).toBe("explicit_wait");
  }, 60_000);
});
