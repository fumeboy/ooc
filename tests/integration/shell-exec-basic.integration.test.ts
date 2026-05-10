import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: shell-exec-basic", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent counts ts files via shell and ends", async () => {
    const root = await makeRootThread(
      tempRoot,
      "请用 shell 命令查一下 src/persistable/ 下有几个 .ts 文件（不含 __tests__/ 子目录），告诉我数字然后 end。"
    );

    await runScheduler(root, llm(), { maxTicks: 12 });

    expect(root.status).toBe("done");
    expect(root.endSummary?.length ?? 0).toBeGreaterThan(0);
    expect(countEventsWithPrefix(root, "[form executed]")).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
