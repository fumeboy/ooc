import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "@ooc/core/thinkable/scheduler";
import {
  countFormExecutions,
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
      [
        "请用 program method（language=shell）执行 shell 命令，",
        "查 src/persistable/ 下有几个 .ts 文件（不含 __tests__/ 子目录）。",
        "看到 form 的 result 字段后，把数字写进 end method 的 summary 然后 end。",
        "重要：执行 shell 必须用 program method；result 会出现在 contextWindows 对应 form 的 result 字段，不需要 wait。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 12 });

    expect(root.status).toBe("done");
    expect(root.endSummary?.length ?? 0).toBeGreaterThan(0);
    expect(countFormExecutions(root)).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
