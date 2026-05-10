import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countEventsWithPrefix,
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
        "用 shell 找 src/ 下行数最多的 .ts 文件（不含 __tests__/）。",
        "找到后再用一次 shell 打印它的前 20 行。",
        "最后 end。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 14 });

    expect(root.status).toBe("done");
    expect(countEventsWithPrefix(root, "[form executed]")).toBeGreaterThanOrEqual(2);
  }, 180_000);
});
