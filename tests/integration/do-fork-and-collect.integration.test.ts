import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import { threadFile } from "../../src/persistable";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: do-fork-and-collect", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("supervisor forks a sub-thread, waits for it, then ends", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请派一个子线程（do command, context=fork, wait=true）执行任务：",
        "用 shell 数 src/ 下所有 .ts 文件总数。",
        "等子线程完成后，告诉我数字然后 end。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 16 });

    expect(root.status).toBe("done");
    expect(root.childThreadIds?.length ?? 0).toBeGreaterThanOrEqual(1);

    const childId = root.childThreadIds![0]!;
    const child = root.childThreads![childId]!;
    expect(child.status).toBe("done");
    expect(countEventsWithPrefix(child, "[form executed]")).toBeGreaterThanOrEqual(1);

    if (child.persistence) {
      const saved = JSON.parse(await readFile(threadFile(child.persistence), "utf8"));
      expect(saved.status).toBe("done");
    }
  }, 180_000);
});
