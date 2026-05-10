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
        "请演示 close tool 的用法：先 open 一个 program command form（type=command, command=program, args={language:'shell', code:'ls'}）。",
        "然后立即用 close tool 关闭它（不要 submit！只 close），reason='演示放弃这次行动'。",
        "之后 open type=command command=end 再 submit 来结束线程。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 8 });

    expect(root.status).toBe("done");
    expect(countEventsWithPrefix(root, "[close]")).toBeGreaterThanOrEqual(1);
    expect(countEventsWithPrefix(root, "[form executed]")).toBe(0);
  }, 120_000);
});
