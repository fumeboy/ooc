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
        "请先做一份执行计划（open type=command command=plan）：'数 src/ 下所有 .ts 文件总数'。",
        "然后用 program command（language=shell）执行 shell 命令，",
        "看到 form 的 result 字段后，把数字写进 end command 的 summary 然后 end。",
        "重要：执行 shell 用 program command 不是 do command；程序结果会出现在 active_forms 中对应 form 的 result 字段，不需要 wait。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 14 });

    expect(root.status).toBe("done");
    expect(root.plan?.length ?? 0).toBeGreaterThan(0);
    expect(countEventsWithPrefix(root, "[form executed]")).toBeGreaterThanOrEqual(2);
  }, 180_000);
});
