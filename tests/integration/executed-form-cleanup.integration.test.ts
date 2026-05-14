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
        "请用 program command（language=shell, code='ls src/'）执行 shell。",
        "submit 后看到 form status=executed 和 result，立刻用 close tool 关闭那个 form（reason='已读取结果'）。",
        "然后 open(type=command, command=end) 提交结束。",
        "重要：result 已在 active_forms 中可见，不需要 wait。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 10 });

    expect(root.status).toBe("done");
    expect(countEventsWithPrefix(root, "[form executed]")).toBeGreaterThanOrEqual(1);
    expect(countEventsWithPrefix(root, "[close]")).toBeGreaterThanOrEqual(1);

    const programForms = root.contextWindows.filter(
      (w) => w.type === "command_exec" && w.command === "program",
    );
    expect(programForms.length).toBe(0);
  }, 120_000);
});
