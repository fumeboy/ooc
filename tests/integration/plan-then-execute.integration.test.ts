import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: plan-then-execute", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent makes a plan then executes via shell", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请先做一份执行计划（用 plan command）：'数 src/ 下所有 .ts 文件总数'。",
        "然后按计划用 shell 执行，把数字告诉我，最后 end。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 14 });

    expect(root.status).toBe("done");
    expect(root.plan?.length ?? 0).toBeGreaterThan(0);
    expect(countEventsWithPrefix(root, "[form executed]")).toBeGreaterThanOrEqual(2);
  }, 180_000);
});
