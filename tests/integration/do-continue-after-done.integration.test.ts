import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: do-continue-after-done", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("supervisor appends task to sub-thread via do.continue + wait", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请派一个子线程执行 task A：用 shell 数 src/persistable/ 下的 .ts 文件数。",
        "（用 do command, context=fork, wait=true）",
        "等子线程完成 task A 后，再用 do command, context=continue, threadId=<刚才那个子线程的 id>, wait=true",
        "追加 task B：用 shell 数 src/thinkable/ 下的 .ts 文件数。",
        "等 task B 也完成后，告诉我两个数字然后 end。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 20 });

    expect(root.status).toBe("done");
    expect(root.childThreadIds?.length).toBe(1);

    const childId = root.childThreadIds![0]!;
    const child = root.childThreads![childId]!;
    expect(child.status).toBe("done");

    expect(countEventsWithPrefix(child, "[form executed]")).toBeGreaterThanOrEqual(2);
  }, 240_000);
});
