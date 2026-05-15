import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: abandon-via-close", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent opens program form then closes without submit", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请演示 close tool 的用法：先 open(command=\"program\", title=\"...\") 创建一个 form（不要直接给齐 args 触发立即提交；保持 form 处于 open 待 refine）。",
        "然后立即用 close(window_id=<form id>, reason=\"演示放弃这次行动\") 关闭它（不要 submit）。",
        "之后 open(command=\"end\") 结束线程。",
      ].join("\n"),
    );

    await runScheduler(root, llm(), { maxTicks: 8 });

    expect(root.status).toBe("done");
    expect(countEventsWithPrefix(root, "[close]")).toBeGreaterThanOrEqual(1);
    expect(countEventsWithPrefix(root, "[form executed]")).toBe(0);
  }, 120_000);
});
