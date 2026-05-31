import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countFormExecutions,
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

  test("agent uses todo_add to track two tasks then completes them via program_window", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "你接下来要完成两件事：",
        "(1) 数 src/persistable/ 下 .ts 文件数量；",
        "(2) 数 src/thinkable/ 下 .ts 文件数量。",
        "请先各调用一次 open(command=\"todo_add\", title=\"...\", args={ content: \"...\" }) 把两件事登记成对象级待办（args 给齐时 open 会立即提交 form；返回值含 todo id，未完成的待办会出现在 <self_view><todos> 自视切片）。",
        "然后逐个调 open(command=\"program\", title=\"...\", args={ language: \"shell\", code: \"...\" }) 执行 shell；",
        "执行完后用 open(command=\"todo_check\", args={ id: <对应 todo id> }) 把相应待办标记完成；",
        "全部完成后 open(command=\"end\") 结束父线程。",
        "重要：args 给齐时 open 立即提交 form；结果在 program_window.history 中可见，不需要 wait。",
      ].join("\n"),
    );

    await runScheduler(root, llm(), { maxTicks: 18 });

    expect(root.status).toBe("done");

    // 至少 2 个 program_window form executed（todo_window 在 args 给齐时被一步直建）
    expect(countFormExecutions(root)).toBeGreaterThanOrEqual(2);
  }, 240_000);
});
