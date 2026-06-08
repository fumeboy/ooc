import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "@ooc/core/thinkable/scheduler";
import {
  countFormExecutions,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";
import type { MethodExecWindow } from "@ooc/core/executable/windows/_shared/types";

describe.skipIf(!hasLlmEnv)("integration: executed-form-cleanup", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent runs program (open auto-submits when args complete), confirms no command_exec residue, then ends", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请用 open(method=\"program\", title=\"...\", args={ language: \"shell\", code: \"ls src/\" }) 执行 shell（args 给齐时 open 会立即提交 form）。",
        "结果会进 program_window.history，不会留下 command_exec form。",
        "然后用 close(window_id=<program_window id>) 关闭 program_window。",
        "最后 open(method=\"end\") 结束线程。",
        "重要：result 已在 program_window.history 中可见，不需要 wait。",
      ].join("\n"),
    );

    await runScheduler(root, llm(), { maxTicks: 10 });

    expect(root.status).toBe("done");
    expect(countFormExecutions(root)).toBeGreaterThanOrEqual(1);

    const programForms = root.contextWindows.filter(
      (w) => w.type === "method_exec" && (w as MethodExecWindow).method === "program",
    );
    expect(programForms.length).toBe(0);
  }, 120_000);
});
