import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "@ooc/core/thinkable/scheduler";
import {
  countFormExecutions,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: multi-shell-chain", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent finds the largest ts file then prints its first 20 lines", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请用 program method（language=shell）执行第一段 shell：找 src/ 下行数最多的 .ts 文件（不含 __tests__/）。",
        "看到 form 的 result 后再用 program method（language=shell）执行第二段：cat 那个文件的前 20 行。",
        "最后用 end method 结束。",
        "重要：每段 shell 都是 program method；result 在 contextWindows 中，不需要 wait。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 14 });

    expect(root.status).toBe("done");
    expect(countFormExecutions(root)).toBeGreaterThanOrEqual(2);
  }, 180_000);
});
