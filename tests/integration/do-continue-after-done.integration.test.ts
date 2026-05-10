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
        "请用 do command（context=fork, wait=true）派生子线程，msg='请用 program(language=shell) 跑 find src/persistable -type f -name *.ts | wc -l 然后 end'。",
        "等子线程完成 task A（你会从 waiting 醒来），active_forms 与 system context 会显示子线程 id。",
        "然后再次 open do command（context=continue, threadId=<那个子线程 id>, wait=true, msg='请再用 program(language=shell) 跑 find src/thinkable -type f -name *.ts | wc -l 然后 end'）追加 task B。",
        "等 task B 也完成后（再次从 waiting 醒来），open(end)+submit 结束。",
        "重要：你不在父线程跑 shell，只用 do command 派生/追加。",
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
