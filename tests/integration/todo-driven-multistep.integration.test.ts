import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: todo-driven-multistep", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent uses todo to track two tasks then completes them via shell", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "你接下来要完成两件事：",
        "(1) 数 src/persistable/ 下 .ts 文件数量；",
        "(2) 数 src/thinkable/ 下 .ts 文件数量。",
        "请先用 todo command 把这两件事登记成 todo（open + refine + submit 各一次），",
        "然后逐个用 shell 执行，每完成一件后用 close 把对应 todo form 关闭。",
        "全部完成后 end。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 18 });

    expect(root.status).toBe("done");

    // 至少 4 个 form executed：2 个 todo + 2 个 program
    expect(countEventsWithPrefix(root, "[form executed]")).toBeGreaterThanOrEqual(4);
    expect(countEventsWithPrefix(root, "[form executing]")).toBeGreaterThanOrEqual(4);
  }, 240_000);
});
