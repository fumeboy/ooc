import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import { threadFile } from "../../src/persistable";
import {
  countFormExecutions,
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
        "请用 open(command=\"do\", title=\"统计 ts 文件\", args={ msg: '请用 program(language=shell) 跑 find src -type f -name *.ts | wc -l 然后 end', wait: true }) 派生子线程。",
        "等子线程完成后（你会从 waiting 醒来），用 open(command=\"end\") 结束父线程。",
        "重要：args 给齐时 open 会立即提交 form；不要在父线程里直接跑 shell。",
      ].join("\n"),
    );

    await runScheduler(root, llm(), { maxTicks: 16 });

    expect(root.status).toBe("done");
    expect(root.childThreadIds?.length ?? 0).toBeGreaterThanOrEqual(1);

    const childId = root.childThreadIds![0]!;
    const child = root.childThreads![childId]!;
    expect(child.status).toBe("done");
    expect(countFormExecutions(child)).toBeGreaterThanOrEqual(1);

    if (child.persistence) {
      const saved = JSON.parse(await readFile(threadFile(child.persistence), "utf8"));
      expect(saved.status).toBe("done");
    }
  }, 180_000);
});
