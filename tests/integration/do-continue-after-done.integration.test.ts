import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countFormExecutions,
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

  test("supervisor appends task to sub-thread via do_window.continue + wait", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请用 open(command=\"do\", title=\"任务A\", args={ msg: '请用 program(language=shell) 跑 find src/persistable -type f -name *.ts | wc -l 然后 end', wait: true }) 派生子线程。",
        "等子线程完成 task A（你会从 waiting 醒来），父线程的 contextWindows 中会有一个指向该子线程的 do_window。",
        "然后通过 open(parent_window_id=<那个 do_window id>, command=\"continue\", args={ msg: '请再用 program(language=shell) 跑 find src/thinkable -type f -name *.ts | wc -l 然后 end', wait: true }) 追加 task B。",
        "等 task B 也完成后（再次从 waiting 醒来），open(command=\"end\") 结束父线程。",
        "重要：你不在父线程跑 shell，只通过 do_window 派生/追加。",
      ].join("\n"),
    );

    await runScheduler(root, llm(), { maxTicks: 20 });

    expect(root.status).toBe("done");
    expect(root.childThreadIds?.length).toBe(1);

    const childId = root.childThreadIds![0]!;
    const child = root.childThreads![childId]!;
    expect(child.status).toBe("done");

    // 至少 2 次 program_window 创建（每次首 exec 都会写一条 form executed）
    expect(countFormExecutions(child)).toBeGreaterThanOrEqual(2);
  }, 240_000);
});
