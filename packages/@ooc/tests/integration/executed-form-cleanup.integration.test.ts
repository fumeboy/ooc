import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "@ooc/core/thinkable/scheduler";
import {
  countFormExecutions,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";
import type { MethodExecWindow } from "@ooc/core/_shared/types/context-window.js";

describe.skipIf(!hasLlmEnv)("integration: executed-form-cleanup", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent runs bash (open auto-submits when args complete), confirms no method_exec residue, then ends", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请用 open(method=\"run\", title=\"...\", args={ code: \"ls src/\" }) 跑一段 bash（args 给齐时 open 会立即提交 form）。",
        "结果会进 terminal_process.history，不会留下 method_exec form。",
        "然后用 close(window_id=<terminal_process id>) 关闭 terminal_process。",
        "最后 open(method=\"end\") 结束线程。",
        "重要：result 已在 terminal_process.history 中可见，不需要 wait。",
      ].join("\n"),
    );

    await runScheduler(root, llm(), { maxTicks: 10 });

    expect(root.status).toBe("done");
    expect(countFormExecutions(root)).toBeGreaterThanOrEqual(1);

    const runForms = root.contextWindows.filter(
      (w) => w.class === "method_exec" && (w as MethodExecWindow).method === "run",
    );
    expect(runForms.length).toBe(0);
  }, 120_000);
});
