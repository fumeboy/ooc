import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countFormExecutions,
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

  test("agent makes a plan then executes via program_window", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请先用 open(command=\"plan\", title=\"...\", args={ plan: \"数 src/ 下所有 .ts 文件总数\" }) 做一份计划（args 给齐时 open 会立即提交 form）。",
        "然后用 open(command=\"program\", title=\"...\", args={ language: \"shell\", code: \"...\" }) 执行 shell；",
        "结果会写进 program_window.history。读取后 open(command=\"end\", args={ summary: \"...\" }) 结束并把数字写进 summary。",
        "重要：args 给齐时 open 立即提交 form；不需要单独 wait。",
      ].join("\n"),
    );

    await runScheduler(root, llm(), { maxTicks: 14 });

    expect(root.status).toBe("done");
    // 2026-05-26: plan 升格为 plan_window
    const planWindow = root.contextWindows.find((w) => w.type === "plan");
    expect(planWindow?.type).toBe("plan");
    expect(countFormExecutions(root)).toBeGreaterThanOrEqual(1);
  }, 180_000);
});
